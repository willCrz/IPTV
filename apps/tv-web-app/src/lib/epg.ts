import type { EpgProgram } from '@/store';

// ── Utilities ────────────────────────────────────────────────

/** Decode base64-encoded Xtream titles/descriptions (UTF-8 safe) */
function b64(s: string): string {
  if (!s) return '';
  try { return decodeURIComponent(escape(atob(s))); } catch { return s; }
}

/** Normalize any timestamp format to milliseconds */
function toMs(ts: number | string | undefined, dateStr: string): number {
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (n && n > 1_000_000_000_000) return n;          // already ms
  if (n && n > 1_000_000_000)     return n * 1000;   // Unix seconds → ms
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? 0 : d.getTime();
  } catch { return 0; }
}

/** Parse XMLTV date string: "20240101120000 +0100" → Unix ms */
function parseXmltvDate(s: string): number {
  if (!s) return 0;
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return 0;
  const [, yr, mo, dy, hr, mn, sc, tz = '+0000'] = m;
  const tzFormatted = tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+00:00';
  const iso = `${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${tzFormatted}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── Xtream Short EPG ─────────────────────────────────────────

export async function fetchXtreamChannelEpg(
  serverUrl: string,
  username: string,
  password: string,
  streamId: string | number,
  limit = 12,
): Promise<EpgProgram[]> {
  const base = serverUrl.replace(/\/$/, '');
  const xtUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_short_epg&stream_id=${streamId}&limit=${limit}`;
  const url = `/api/proxy?url=${encodeURIComponent(xtUrl)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 429) throw new Error('rate-limited');
    if (!res.ok) return [];

    const data = await res.json() as {
      epg_listings?: Array<{
        id?: string; title: string; description?: string;
        start?: string; end?: string;
        // Xtream may return timestamps as strings or numbers
        start_timestamp?: number | string; stop_timestamp?: number | string;
      }>;
    };

    const listings = data.epg_listings || [];
    const now = Date.now();
    const channelId = `xt_${streamId}`;

    return listings
      .map((l, i) => {
        const startMs = toMs(l.start_timestamp, l.start || '');
        const endMs   = toMs(l.stop_timestamp,  l.end   || '');
        if (!startMs || !endMs || endMs <= startMs) return null;
        const isNow  = startMs <= now && endMs > now;
        const isPast = endMs < now;
        return {
          id: l.id || `${channelId}_${i}`,
          title: b64(l.title) || 'Sem informação',
          description: l.description ? b64(l.description) : undefined,
          startTime: new Date(startMs).toISOString(),
          endTime:   new Date(endMs).toISOString(),
          channelId,
          isNow,
          isPast,
          progress: isNow ? Math.round((now - startMs) / (endMs - startMs) * 100) : 0,
        } as EpgProgram;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null) as EpgProgram[];
  } catch {
    return [];
  }
}

// 10 concurrent requests at a time; 100 ms gap between batches
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 100;

export async function fetchXtreamBatchEpg(
  serverUrl: string,
  username: string,
  password: string,
  streamIds: (string | number)[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<Record<string, EpgProgram[]>> {
  const result: Record<string, EpgProgram[]> = {};
  let loaded = 0;

  for (let i = 0; i < streamIds.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    const batch = streamIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(id => fetchXtreamChannelEpg(serverUrl, username, password, id))
    );
    batch.forEach((id, j) => {
      const r = results[j];
      if (r.status === 'fulfilled') {
        // [] = server confirmed no EPG via short-epg; won't be retried unless XMLTV fallback overrides
        result[`xt_${id}`] = r.value;
      }
      // rejected (429 / network error) → not added, stays undefined → retryable
    });
    loaded += batch.length;
    onProgress?.(Math.min(loaded, streamIds.length), streamIds.length);
  }

  return result;
}

// ── XMLTV EPG ────────────────────────────────────────────────

/** Normalize a channel name for fuzzy matching (strip quality/variant tags) */
function normName(n: string | null | undefined): string {
  if (!n) return '';
  return n.toLowerCase()
    .replace(/\s*[\[(](uhd|4k|fhd|hd|sd|h\.?265|h265|alt\d*|alt|backup)[)\]]/gi, '')
    .replace(/\s+(uhd|4k|fhd|hd|sd)(\s|$)/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** In-memory cache: xmltvUrl → { programs by tvgId, nameMap, timestamp } */
const xmltvCache = new Map<string, {
  programs: Record<string, EpgProgram[]>;
  /** Normalized display-name → XMLTV channel id — only for non-zero ids */
  nameMap: Record<string, string>;
  parsedAt: number;
}>();
const XMLTV_TTL      = 60 * 60_000; // 60 minutes — XMLTV data changes rarely
const XMLTV_ERR_TTL  =  5 * 60_000; // 5 minutes before retrying a failed URL
const XMLTV_MAX_CACHE = 3;           // keep at most 3 parsed documents in memory

function evictOldestXmltvEntry() {
  if (xmltvCache.size <= XMLTV_MAX_CACHE) return;
  let oldestKey = '';
  let oldestTs = Infinity;
  for (const [k, v] of xmltvCache.entries()) {
    if (v.parsedAt < oldestTs) { oldestTs = v.parsedAt; oldestKey = k; }
  }
  if (oldestKey) xmltvCache.delete(oldestKey);
}

/** Parse a full XMLTV document; returns programs by channel-id and a name→id map */
function parseXmltvDoc(xmlText: string): {
  programs: Record<string, EpgProgram[]>;
  nameMap: Record<string, string>;
} {
  if (typeof DOMParser === 'undefined') return { programs: {}, nameMap: {} };

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  if (doc.querySelector('parsererror')) return { programs: {}, nameMap: {} };

  // Build name→id map from <channel> declarations (skip id="0" — not unique)
  const nameMap: Record<string, string> = {};
  for (const ch of doc.querySelectorAll('channel')) {
    const id = ch.getAttribute('id') || '0';
    if (id === '0') continue;
    const displayName = ch.querySelector('display-name')?.textContent?.trim();
    if (displayName) {
      const norm = normName(displayName);
      if (norm && !nameMap[norm]) nameMap[norm] = id;
    }
  }

  const programs: Record<string, EpgProgram[]> = {};
  const now = Date.now();
  // Keep programs within a 14-hour window (2h past → 12h future)
  const windowStart = now - 2 * 3600_000;
  const windowEnd   = now + 12 * 3600_000;

  for (const prog of doc.querySelectorAll('programme')) {
    const tvgId = prog.getAttribute('channel');
    if (!tvgId) continue;

    // Prefer numeric timestamps when present (avoids timezone parsing edge cases)
    const startTsAttr = prog.getAttribute('start_timestamp');
    const stopTsAttr  = prog.getAttribute('stop_timestamp');
    const startMs = startTsAttr
      ? Number(startTsAttr) * 1000
      : parseXmltvDate(prog.getAttribute('start') || '');
    const stopMs = stopTsAttr
      ? Number(stopTsAttr) * 1000
      : parseXmltvDate(prog.getAttribute('stop') || '');
    if (!startMs || !stopMs || stopMs <= startMs) continue;
    if (stopMs < windowStart || startMs > windowEnd) continue;

    const title = prog.querySelector('title')?.textContent?.trim() || 'Sem informação';
    const desc  = prog.querySelector('desc')?.textContent?.trim()  || undefined;
    const isNow  = startMs <= now && stopMs > now;
    const isPast = stopMs < now;

    const program: EpgProgram = {
      id: `xmltv_${tvgId}_${startMs}`,
      title,
      description: desc,
      startTime: new Date(startMs).toISOString(),
      endTime:   new Date(stopMs).toISOString(),
      channelId: tvgId,
      isNow,
      isPast,
      progress: isNow ? Math.round((now - startMs) / (stopMs - startMs) * 100) : 0,
    };

    if (!programs[tvgId]) programs[tvgId] = [];
    programs[tvgId].push(program);
  }

  // ISO-8601 strings sort correctly with plain string comparison — no Date parsing needed.
  for (const tvgId in programs) {
    programs[tvgId].sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  }

  return { programs, nameMap };
}

/** Internal: fetch + parse XMLTV, returning cached result when fresh */
async function getXmltvData(xmltvUrl: string): Promise<{
  programs: Record<string, EpgProgram[]>;
  nameMap: Record<string, string>;
} | null> {
  const cached = xmltvCache.get(xmltvUrl);
  if (cached && Date.now() - cached.parsedAt < XMLTV_TTL) {
    return { programs: cached.programs, nameMap: cached.nameMap };
  }

  const proxyUrl = `/api/proxy?url=${encodeURIComponent(xmltvUrl)}`;
  const empty = { programs: {}, nameMap: {} };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(proxyUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    // Proxy converts upstream 404 → 200 + X-Upstream-Status:404
    if (res.headers.get('X-Upstream-Status') === '404') {
      xmltvCache.set(xmltvUrl, { ...empty, parsedAt: Date.now() - XMLTV_TTL + XMLTV_ERR_TTL });
      evictOldestXmltvEntry();
      return null;
    }

    const text = await res.text();
    if (!text.trimStart().startsWith('<')) {
      xmltvCache.set(xmltvUrl, { ...empty, parsedAt: Date.now() - XMLTV_TTL + XMLTV_ERR_TTL });
      evictOldestXmltvEntry();
      return null;
    }

    // Yield before the synchronous DOMParser call to keep the event loop responsive
    await new Promise<void>(r => setTimeout(r, 0));
    const parsed = parseXmltvDoc(text);
    xmltvCache.set(xmltvUrl, { ...parsed, parsedAt: Date.now() });
    evictOldestXmltvEntry();
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetch XMLTV EPG for a list of tvg-ids (legacy / M3U usage).
 * Returns programs keyed by tvgId.
 */
export async function fetchXmltvEpg(
  xmltvUrl: string,
  tvgIds: string[],
): Promise<Record<string, EpgProgram[]>> {
  if (!tvgIds.length || !xmltvUrl) return {};
  const data = await getXmltvData(xmltvUrl);
  if (!data) return {};
  const result: Record<string, EpgProgram[]> = {};
  for (const id of tvgIds) if (data.programs[id]) result[id] = data.programs[id];
  return result;
}

/**
 * Fetch XMLTV EPG for full channel objects.
 * Tries tvgId match first; falls back to normalized channel-name match
 * (only against XMLTV channels with non-zero ids — avoids mixing shared id="0" programmes).
 * Returns programs keyed by channel.id (store id), ready to store in epgSchedule.
 */
export async function fetchXmltvEpgForChannels(
  xmltvUrl: string,
  channels: Array<{ id: string; tvgId?: string; name: string }>,
): Promise<Record<string, EpgProgram[]>> {
  if (!channels.length || !xmltvUrl) return {};
  const data = await getXmltvData(xmltvUrl);
  if (!data) return {};

  const result: Record<string, EpgProgram[]> = {};
  for (const ch of channels) {
    let progs: EpgProgram[] | undefined;

    // 1. ID match (fast, exact)
    if (ch.tvgId && ch.tvgId !== '0') progs = data.programs[ch.tvgId];

    // 2. Normalized name fallback (only non-zero XMLTV ids, so no id="0" noise)
    if (!progs && ch.name) {
      const xmltvId = data.nameMap[normName(ch.name)];
      if (xmltvId) progs = data.programs[xmltvId];
    }

    if (progs?.length) {
      result[ch.id] = progs.map(p => ({ ...p, channelId: ch.id }));
    }
  }
  return result;
}

/** Build the standard Xtream XMLTV feed URL */
export function buildXtreamXmltvUrl(serverUrl: string, username: string, password: string): string {
  return `${serverUrl.replace(/\/$/, '')}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

/** Clear the XMLTV in-memory cache (call when playlists are updated) */
export function clearXmltvCache() {
  xmltvCache.clear();
}
