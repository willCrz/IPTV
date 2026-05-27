import { type NextRequest, NextResponse } from 'next/server';

// In-memory response cache (survives across requests in the same process)
const cache = new Map<string, { body: string; contentType: string; cachedAt: number }>();
const JSON_TTL = 15 * 60 * 1000;  // 15 min for Xtream EPG JSON
const XML_TTL  = 60 * 60 * 1000;  // 1 h  for XMLTV

// Per-URL inflight deduplication
const inflight = new Map<string, Promise<NextResponse>>();

// Token-bucket rate limiter: 50 tokens/s (raised for HLS segment fetches)
let tokens = 50;
let lastRefill = Date.now();
const MAX_TOKENS = 50;
const REFILL_INTERVAL_MS = 1000;

function acquireToken(): boolean {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= REFILL_INTERVAL_MS) {
    tokens = MAX_TOKENS;
    lastRefill = now;
  }
  if (tokens > 0) { tokens--; return true; }
  return false;
}

// Rewrite all segment/level lines in an m3u8 manifest so they go through this
// proxy instead of being fetched directly (which would be Mixed Content).
function rewriteM3u8(body: string, originalUrl: string): string {
  let base: URL;
  try { base = new URL(originalUrl); } catch { return body; }

  return body.split('\n').map(line => {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) return line;
    try {
      // Resolve relative URLs against the original manifest URL
      const abs = new URL(trimmed, base.href).href;
      if (abs.startsWith('http://') || abs.startsWith('https://')) {
        return `/api/proxy?url=${encodeURIComponent(abs)}`;
      }
    } catch { /* not a URL */ }
    return line;
  }).join('\n');
}

function isM3u8(url: string, contentType: string): boolean {
  return url.includes('.m3u8') || url.includes('.m3u') ||
    contentType.includes('mpegurl') || contentType.includes('x-mpegurl');
}

async function doFetch(url: string): Promise<NextResponse> {
  if (!acquireToken()) {
    return NextResponse.json({ error: 'Rate limit — retry in a moment' }, {
      status: 429, headers: { 'Retry-After': '1' },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'IPTV-Pro/1.0', 'Accept-Encoding': 'gzip, deflate' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 404) {
        return new NextResponse('{}', {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upstream-Status': '404' },
        });
      }
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status });
    }

    const contentType = res.headers.get('content-type') ?? '';

    // ── HLS manifest: rewrite segment URLs and return text ──
    if (isM3u8(url, contentType)) {
      const body = await res.text();
      const rewritten = rewriteM3u8(body, url);
      return new NextResponse(rewritten, {
        headers: {
          'Content-Type': 'application/x-mpegurl; charset=utf-8',
          'Cache-Control': 'no-cache, no-store',  // live playlists update every few seconds
        },
      });
    }

    // ── Binary media (ts segments, mp4 chunks): stream through without buffering ──
    const isBinary =
      contentType.includes('video') ||
      contentType.includes('audio') ||
      contentType.includes('octet-stream') ||
      /\.(ts|aac|mp4|fmp4|m4s)(\?|$)/.test(url);

    if (isBinary) {
      return new NextResponse(res.body, {
        headers: {
          'Content-Type': contentType || 'video/mp2t',
          'Cache-Control': 'public, max-age=30',
        },
      });
    }

    // ── Text content (JSON API, XMLTV EPG) ──
    const body = await res.text();
    const first = body.trimStart()[0];
    const detected =
      first === '<' ? 'text/xml; charset=utf-8'
      : first === '{' || first === '[' ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
    const finalType = contentType || detected;

    cache.set(url, { body, contentType: finalType, cachedAt: Date.now() });

    return new NextResponse(body, {
      headers: { 'Content-Type': finalType, 'X-Cache': 'MISS' },
    });
  } catch (err) {
    clearTimeout(timeout);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  // Validate protocol
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only http/https allowed' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  // Skip cache for m3u8 (live playlists must not be stale)
  if (!isM3u8(url, '')) {
    const cached = cache.get(url);
    if (cached) {
      const ttl = cached.contentType.includes('json') ? JSON_TTL : XML_TTL;
      if (Date.now() - cached.cachedAt < ttl) {
        return new NextResponse(cached.body, {
          headers: { 'Content-Type': cached.contentType, 'X-Cache': 'HIT' },
        });
      }
      cache.delete(url);
    }
  }

  // Deduplicate inflight requests for the same URL
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = doFetch(url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
