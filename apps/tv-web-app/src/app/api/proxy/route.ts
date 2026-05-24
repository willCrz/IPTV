import { type NextRequest, NextResponse } from 'next/server';

// In-memory response cache (survives across requests in the same process)
const cache = new Map<string, { body: string; contentType: string; cachedAt: number }>();
const JSON_TTL = 15 * 60 * 1000;  // 15 min for Xtream EPG JSON
const XML_TTL  = 60 * 60 * 1000;  // 1 h  for XMLTV

// Per-URL inflight deduplication: if two requests arrive for the same URL while
// one fetch is in progress, the second waits for the first instead of hitting the
// upstream again (prevents the burst of 429s from concurrent EPG loads).
const inflight = new Map<string, Promise<NextResponse>>();

// Token-bucket rate limiter: 25 tokens/s.
// EPG batches can hit 10+ req/s; 25 gives headroom without hammering upstream.
let tokens = 25;
let lastRefill = Date.now();
const MAX_TOKENS = 25;
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

async function doFetch(url: string): Promise<NextResponse> {
  // Rate-limit check
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
      // 404 = resource not found on upstream (e.g. channel has no EPG).
      // Return empty JSON so clients treat it as "no data" instead of an error,
      // and so the Next.js dev server doesn't log a noisy 404 for every EPG miss.
      if (res.status === 404) {
        return new NextResponse('{}', {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upstream-Status': '404' },
        });
      }
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: res.status });
    }

    const body = await res.text();
    const first = body.trimStart()[0];
    const contentType =
      first === '<' ? 'text/xml; charset=utf-8'
      : first === '{' || first === '[' ? 'application/json; charset=utf-8'
      : 'application/x-mpegurl; charset=utf-8';

    cache.set(url, { body, contentType, cachedAt: Date.now() });

    return new NextResponse(body, {
      headers: { 'Content-Type': contentType, 'X-Cache': 'MISS' },
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

  // Cache hit — no upstream request needed
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

  // Deduplicate inflight requests for the same URL
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = doFetch(url).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
