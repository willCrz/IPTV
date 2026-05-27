import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

interface MonitoredServer { id: string; url: string; lastCheck: number; status: string; latencyMs: number; }

const servers = new Map<string, MonitoredServer>();

async function checkServer(server: MonitoredServer, timeout: number): Promise<void> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${server.url}/health`, { signal: controller.signal });
    clearTimeout(t);
    servers.set(server.id, { ...server, status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, lastCheck: Date.now() });
  } catch {
    servers.set(server.id, { ...server, status: 'unhealthy', latencyMs: Date.now() - start, lastCheck: Date.now() });
  }
}

export function startServerMonitor(interval: number, pingTimeout: number) {
  setInterval(() => {
    if (servers.size > 0) {
      Promise.allSettled([...servers.values()].map(s => checkServer(s, pingTimeout)));
    }
  }, interval);
}

export const monitorRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const PING_TIMEOUT = Number(process.env.PING_TIMEOUT ?? 5_000);

  app.get('/servers', async () => ({ servers: [...servers.values()], timestamp: Date.now() }));

  app.post<{ Body: { id: string; url: string } }>(
    '/servers',
    { schema: { body: { type: 'object', required: ['id', 'url'], properties: { id: { type: 'string' }, url: { type: 'string' } } } } },
    async (req, reply) => {
      const { id, url } = req.body;
      servers.set(id, { id, url, lastCheck: 0, status: 'unknown', latencyMs: 0 });
      await checkServer(servers.get(id)!, PING_TIMEOUT);
      reply.status(201).send(servers.get(id));
    }
  );

  app.delete<{ Params: { id: string } }>('/servers/:id', async (req, reply) => {
    servers.delete(req.params.id);
    reply.send({ ok: true });
  });
};
