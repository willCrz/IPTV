import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createHmac, randomBytes } from 'crypto';

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // POST /auth/verify — verificar credenciais Xtream
  app.post<{ Body: { serverUrl: string; username: string; password: string } }>(
    '/verify',
    { schema: { body: { type: 'object', required: ['serverUrl','username','password'], properties: {
      serverUrl: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' },
    }}}},
    async (req, reply) => {
      const { serverUrl, username, password } = req.body;
      const cacheKey = `auth:${Buffer.from(`${serverUrl}:${username}:${password}`).toString('base64').substring(0,32)}`;

      const cached = await app.redis.get(cacheKey);
      if (cached) return reply.send(JSON.parse(cached));

      try {
        const url = `${serverUrl.replace(/\/$/,'')}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'IPTV-Pro/1.0' }});
        clearTimeout(timeout);

        if (!res.ok) return reply.status(401).send({ error: 'Credenciais inválidas', auth: false });
        const data = await res.json() as { user_info?: { auth?: number }; server_info?: unknown };

        if (!data.user_info || data.user_info.auth !== 1) {
          return reply.status(401).send({ error: 'Credenciais inválidas', auth: false });
        }

        const result = { auth: true, userInfo: data.user_info, serverInfo: data.server_info };
        await app.redis.setEx(cacheKey, 300, JSON.stringify(result)); // cache 5min
        reply.send(result);
      } catch (e) {
        reply.status(502).send({ error: e instanceof Error ? e.message : 'Erro de conexão', auth: false });
      }
    }
  );

  // POST /auth/token — gerar token de sessão
  app.post<{ Body: { playlistId: string } }>(
    '/token',
    { schema: { body: { type: 'object', required: ['playlistId'] }}},
    async (req, reply) => {
      const { playlistId } = req.body;
      const token = randomBytes(32).toString('hex');
      const sessionKey = `session:${token}`;
      await app.redis.setEx(sessionKey, 86400, JSON.stringify({ playlistId, createdAt: Date.now() }));
      reply.send({ token, expiresIn: 86400 });
    }
  );
};
