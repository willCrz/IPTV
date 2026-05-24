import Fastify from 'fastify';
import { createClient } from 'redis';

const PORT = Number(process.env.PORT ?? 3002);
const CHECK_INTERVAL = Number(process.env.HEALTH_CHECK_INTERVAL ?? 30_000);
const PING_TIMEOUT = Number(process.env.PING_TIMEOUT ?? 5_000);

interface MonitoredServer { id: string; url: string; lastCheck: number; status: string; latencyMs: number; }

const app = Fastify({ logger: { level: 'info' } });
const servers = new Map<string, MonitoredServer>();

async function checkServer(server: MonitoredServer): Promise<void> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const res = await fetch(`${server.url}/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(t);
    servers.set(server.id, { ...server, status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, lastCheck: Date.now() });
  } catch {
    servers.set(server.id, { ...server, status: 'unhealthy', latencyMs: Date.now() - start, lastCheck: Date.now() });
  }
}

async function runChecks() {
  await Promise.allSettled([...servers.values()].map(checkServer));
}

// Routes
app.get('/health', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));

app.get('/servers', async () => ({ servers: [...servers.values()], timestamp: Date.now() }));

app.post<{ Body: { id: string; url: string } }>('/servers', async (req, reply) => {
  const { id, url } = req.body;
  servers.set(id, { id, url, lastCheck: 0, status: 'unknown', latencyMs: 0 });
  await checkServer(servers.get(id)!);
  reply.status(201).send(servers.get(id));
});

app.delete<{ Params: { id: string } }>('/servers/:id', async (req, reply) => {
  servers.delete(req.params.id);
  reply.send({ ok: true });
});

// Bootstrap
async function bootstrap() {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`🏥 Health Service running on port ${PORT}`);
  setInterval(runChecks, CHECK_INTERVAL);
}

bootstrap().catch(e => { console.error(e); process.exit(1); });
