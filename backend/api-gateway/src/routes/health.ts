import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // GET /health — status geral
  app.get('/', { config: { rateLimit: { max: 300 } } }, async (_req, reply) => {
    const redisOk = await app.redis.ping().then(() => true).catch(() => false);
    const status = redisOk ? 'healthy' : 'degraded';
    reply.status(redisOk ? 200 : 503).send({
      status,
      timestamp: Date.now(),
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage().heapUsed,
      services: { redis: redisOk ? 'ok' : 'error' },
    });
  });

  // GET /health/server — ping + latência
  app.get('/server', async (_req, reply) => {
    const start = Date.now();
    const redisOk = await app.redis.ping().then(() => true).catch(() => false);
    reply.send({
      status: redisOk ? 'healthy' : 'unhealthy',
      latencyMs: Date.now() - start,
      available: true,
      timestamp: Date.now(),
      responseTime: Date.now() - start,
    });
  });

  // GET /health/playlist — verifica se playlist está no cache
  app.get<{ Querystring: { url: string } }>('/playlist', {
    schema: { querystring: { url: { type: 'string' } } },
  }, async (req, reply) => {
    const { url } = req.query;
    if (!url) return reply.status(400).send({ error: 'url é obrigatório' });

    const cacheKey = `playlist:${Buffer.from(url).toString('base64').substring(0, 32)}`;
    const cached = await app.redis.get(cacheKey);

    reply.send({
      url,
      cached: !!cached,
      cachedAt: cached ? JSON.parse(cached).cachedAt : null,
      status: 'healthy',
      timestamp: Date.now(),
    });
  });

  // GET /health/channel/:id — verifica stream de um canal
  app.get<{ Params: { id: string }; Querystring: { url?: string } }>(
    '/channel/:id',
    { schema: { params: { id: { type: 'string' } } } },
    async (req, reply) => {
      const { id } = req.params;
      const { url } = req.query;

      // Verificar cache Redis
      const cacheKey = `channel_health:${id}`;
      const cached = await app.redis.get(cacheKey);
      if (cached) {
        return reply.send(JSON.parse(cached));
      }

      let streamStatus: 'online' | 'offline' | 'unknown' = 'unknown';
      let latencyMs = 0;

      if (url) {
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: { 'User-Agent': 'IPTV-Pro-Health/1.0' },
          });
          clearTimeout(timeout);
          streamStatus = (res.ok || res.status === 405) ? 'online' : 'offline';
          latencyMs = Date.now() - start;
        } catch {
          streamStatus = 'offline';
          latencyMs = Date.now() - start;
        }
      }

      const result = {
        channelId: id,
        streamStatus,
        latencyMs,
        status: streamStatus === 'online' ? 'healthy' : 'unhealthy',
        available: streamStatus === 'online',
        timestamp: Date.now(),
        responseTime: latencyMs,
      };

      // Cache por 30s
      await app.redis.setEx(cacheKey, 30, JSON.stringify(result));
      reply.send(result);
    }
  );
};
