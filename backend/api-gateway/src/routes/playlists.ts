import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const playlistRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // GET /playlists/cache/:id
  app.get<{ Params: { id: string } }>('/cache/:id', async (req, reply) => {
    const data = await app.redis.get(`playlist_data:${req.params.id}`);
    if (!data) return reply.status(404).send({ error: 'Cache não encontrado' });
    reply.send(JSON.parse(data));
  });

  // POST /playlists/cache — armazenar playlist no Redis
  app.post<{ Body: { id: string; data: unknown; ttl?: number } }>(
    '/cache',
    { schema: { body: { type: 'object', required: ['id','data'] }}},
    async (req, reply) => {
      const { id, data, ttl = 3600 } = req.body;
      await app.redis.setEx(`playlist_data:${id}`, ttl, JSON.stringify({ data, cachedAt: Date.now() }));
      reply.send({ ok: true, ttl });
    }
  );

  // DELETE /playlists/cache/:id
  app.delete<{ Params: { id: string } }>('/cache/:id', async (req, reply) => {
    await app.redis.del(`playlist_data:${req.params.id}`);
    reply.send({ ok: true });
  });

  // GET /playlists/stats — estatísticas de cache
  app.get('/stats', async (_req, reply) => {
    const keys = await app.redis.keys('playlist_data:*');
    reply.send({ cachedPlaylists: keys.length, timestamp: Date.now() });
  });
};
