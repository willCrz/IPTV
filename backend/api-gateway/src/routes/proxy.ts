import type { FastifyPluginAsync } from 'fastify';

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { url?: string } }>('/', {
    config: { rateLimit: { max: 1000, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const { url } = req.query;
    if (!url) return reply.code(400).send({ error: 'url parameter required' });

    let target: URL;
    try {
      target = new URL(url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Only http/https URLs allowed' });
      }
    } catch {
      return reply.code(400).send({ error: 'Invalid URL' });
    }

    try {
      const response = await fetch(target.toString(), {
        headers: { 'User-Agent': 'IPTV-Pro/1.0', 'Accept': 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(30_000),
      });

      const ct = response.headers.get('content-type') ?? 'application/octet-stream';
      void reply.header('Content-Type', ct);
      void reply.code(response.status);
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      return reply.code(502).send({ error: 'Upstream fetch failed', detail: (e as Error).message });
    }
  });
};
