import crypto from 'crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

/** Collision-safe Redis key: SHA-1 hex of the full URL */
function urlKey(prefix: string, url: string): string {
  return `${prefix}:${crypto.createHash('sha1').update(url).digest('hex')}`;
}

export const streamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // GET /streams/proxy — proxy de playlist M3U, XMLTV ou JSON de EPG (evita CORS)
  app.get<{ Querystring: { url: string } }>(
    '/proxy',
    { schema: { querystring: { url: { type: 'string' } } } },
    async (req, reply) => {
      const { url } = req.query;
      if (!url) return reply.status(400).send({ error: 'url é obrigatório' });

      const cacheKey = urlKey('proxy', url);
      const cached = await app.redis.get(cacheKey);

      if (cached) {
        const first = cached.trimStart()[0];
        const ct = first === '<' ? 'text/xml'
          : first === '{' || first === '[' ? 'application/json'
          : 'application/x-mpegurl';
        return reply.header('Content-Type', ct).header('X-Cache', 'HIT').send(cached);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'IPTV-Pro/1.0', 'Accept-Encoding': 'gzip, deflate' },
        });
        clearTimeout(timeout);

        if (!res.ok) return reply.status(res.status).send({ error: `Upstream retornou ${res.status}` });

        const content = await res.text();
        const first = content.trimStart()[0];
        const isXml  = first === '<';
        const isJson = first === '{' || first === '[';
        const contentType = isXml ? 'text/xml' : isJson ? 'application/json' : 'application/x-mpegurl';

        // JSON (Xtream EPG): cache 15 min — M3U/XML: cache 1 hora
        const ttl = isJson ? 900 : 3600;
        await app.redis.setEx(cacheKey, ttl, content);

        reply.header('Content-Type', contentType).header('X-Cache', 'MISS').send(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao fazer proxy';
        reply.status(502).send({ error: msg });
      }
    }
  );

  // GET /streams/epg-proxy — proxy dedicado para arquivos XMLTV/EPG com cache curto
  app.get<{ Querystring: { url: string } }>(
    '/epg-proxy',
    { schema: { querystring: { url: { type: 'string' } } } },
    async (req, reply) => {
      const { url } = req.query;
      if (!url) return reply.status(400).send({ error: 'url é obrigatório' });

      const cacheKey = urlKey('epg', url);
      const cached = await app.redis.get(cacheKey);

      if (cached) {
        return reply.header('Content-Type', 'text/xml').header('X-Cache', 'HIT').send(cached);
      }

      try {
        const controller = new AbortController();
        // EPG files can be large — allow 30s
        const timeout = setTimeout(() => controller.abort(), 30_000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'IPTV-Pro/1.0', 'Accept-Encoding': 'gzip, deflate' },
        });
        clearTimeout(timeout);

        if (!res.ok) return reply.status(res.status).send({ error: `Upstream retornou ${res.status}` });

        const content = await res.text();

        // EPG updates every few hours — cache 15 minutes to keep data fresh
        await app.redis.setEx(cacheKey, 900, content);

        reply.header('Content-Type', 'text/xml').header('X-Cache', 'MISS').send(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao fazer proxy EPG';
        reply.status(502).send({ error: msg });
      }
    }
  );

  // GET /streams/check — verificar bitrate de um stream
  app.get<{ Querystring: { url: string; duration?: string } }>(
    '/check',
    { schema: { querystring: { url: { type: 'string' }, duration: { type: 'string' } } } },
    async (req, reply) => {
      const { url, duration: durStr = '3' } = req.query;
      if (!url) return reply.status(400).send({ error: 'url é obrigatório' });

      const duration = Math.min(Number(durStr) || 3, 10); // max 10s
      const startTime = Date.now();
      let bytesReceived = 0;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), duration * 1000 + 2000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'IPTV-Pro-Check/1.0' },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return reply.send({ available: false, bitrate: 0, latencyMs: Date.now() - startTime });
        }

        const reader = res.body?.getReader();
        if (!reader) return reply.send({ available: true, bitrate: 0, latencyMs: 0 });

        const stopAt = Date.now() + duration * 1000;
        while (Date.now() < stopAt) {
          const { done, value } = await reader.read();
          if (done) break;
          bytesReceived += value?.byteLength ?? 0;
        }
        reader.cancel();

        const elapsed = (Date.now() - startTime) / 1000;
        const bitrate = Math.round((bytesReceived * 8) / elapsed);

        reply.send({
          available: true,
          bitrate,
          bitrateKbps: Math.round(bitrate / 1000),
          bytesReceived,
          durationSecs: elapsed,
          latencyMs: Date.now() - startTime,
        });
      } catch {
        reply.send({ available: false, bitrate: 0, latencyMs: Date.now() - startTime });
      }
    }
  );
};
