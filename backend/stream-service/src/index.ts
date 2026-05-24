import Fastify from 'fastify';
import { createClient } from 'redis';

const PORT = Number(process.env.PORT ?? 3003);
const STREAM_TIMEOUT = Number(process.env.STREAM_TIMEOUT ?? 10_000);

const app = Fastify({ logger: { level: 'info' } });

app.get('/health', async () => ({ status: 'ok' }));

// GET /stream/info?url=... — informações do stream (bitrate, codec)
app.get<{ Querystring: { url: string } }>('/info', async (req, reply) => {
  const { url } = req.query;
  if (!url) return reply.status(400).send({ error: 'url obrigatória' });

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, headers: { 'User-Agent': 'IPTV-Pro/1.0' }});
    clearTimeout(timeout);

    const contentType = res.headers.get('content-type') ?? '';
    const contentLength = res.headers.get('content-length');
    const available = res.ok || res.status === 405;

    reply.send({
      url, available, latencyMs: Date.now() - start,
      contentType, contentLength: contentLength ? parseInt(contentLength) : null,
      headers: Object.fromEntries(res.headers.entries()),
      statusCode: res.status,
    });
  } catch (e) {
    reply.send({ url, available: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : 'Timeout' });
  }
});

// GET /stream/bitrate?url=...&duration=3 — medir bitrate
app.get<{ Querystring: { url: string; duration?: string } }>('/bitrate', async (req, reply) => {
  const { url, duration: durStr = '3' } = req.query;
  if (!url) return reply.status(400).send({ error: 'url obrigatória' });

  const duration = Math.min(Number(durStr) || 3, 8);
  const start = Date.now();
  let bytes = 0;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), duration * 1000 + 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return reply.send({ available: false, bitrate: 0 });

    const reader = res.body?.getReader();
    if (!reader) return reply.send({ available: true, bitrate: 0 });

    const stopAt = Date.now() + duration * 1000;
    while (Date.now() < stopAt) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
    }
    reader.cancel();

    const elapsed = (Date.now() - start) / 1000;
    reply.send({ available: true, bytes, bitrate: Math.round((bytes * 8) / elapsed), bitrateKbps: Math.round((bytes * 8) / elapsed / 1000), elapsed });
  } catch {
    reply.send({ available: false, bitrate: 0 });
  }
});

async function bootstrap() {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`📡 Stream Service running on port ${PORT}`);
}

bootstrap().catch(e => { console.error(e); process.exit(1); });
