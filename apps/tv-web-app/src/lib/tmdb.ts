// TMDB (The Movie Database) metadata enrichment
// Requires NEXT_PUBLIC_TMDB_KEY set in .env.local
//
// Two key formats are accepted automatically:
//   v3 API Key  — short alphanumeric string  → sent as ?api_key=KEY
//   v4 Bearer   — long JWT starting with eyJ → sent as Authorization: Bearer TOKEN
//
// Get your key at: https://www.themoviedb.org/settings/api
// (use "API Read Access Token" if available — it's the v4 Bearer format)

const IMG = 'https://image.tmdb.org/t/p';
const API  = 'https://api.themoviedb.org/3';

export interface TmdbMeta {
  plot:        string;
  rating:      string;
  year:        string;
  genre:       string;
  cast:        string;
  director:    string;
  poster?:     string;
  backdrop?:   string;
  trailerKey?: string;  // YouTube video key for the trailer
}

function getKey() { return (process.env.NEXT_PUBLIC_TMDB_KEY || '').trim(); }

// Detect v4 Bearer token vs v3 api_key
function isBearer(k: string) { return k.startsWith('eyJ'); }

// Build fetch options with correct auth
function opts(k: string): RequestInit {
  return isBearer(k)
    ? { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8_000) }
    : { signal: AbortSignal.timeout(8_000) };
}

// Build URL — v3 key goes in query string; Bearer token needs no api_key param
function url(path: string, params: Record<string, string>, k: string): string {
  const p: Record<string, string> = isBearer(k)
    ? params
    : { api_key: k, ...params };
  const qs = Object.entries(p)
    .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
    .join('&');
  return `${API}${path}?${qs}`;
}

/** Strip common IPTV noise from a title before sending to TMDB */
export function cleanTitle(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .replace(/\s*[\[(](dub|dublado|leg|legendado|sub|HD|FHD|4K|UHD|SDR|HDR|HEVC|x265|x264|BluRay|WEB-?DL|TS|CAM|Nacional|PT-?BR|PTBR)[\])]/gi, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s*[-–|]\s*(dublado|dub|legendado|leg|sub)\s*$/i, '')
    .trim();
}

interface SearchHit {
  id: number;
  overview: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

interface Credits {
  cast?: Array<{ name: string; order: number }>;
  crew?: Array<{ name: string; job: string; department: string }>;
}

interface Details {
  genres?: Array<{ id: number; name: string }>;
}

interface VideoResult {
  key:  string;
  site: string;
  type: string;
  iso_639_1: string;
  official: boolean;
}

interface Videos {
  results?: VideoResult[];
}

// ── In-memory cache + inflight deduplication ─────────────────
const _cache    = new Map<string, { meta: TmdbMeta | null; cachedAt: number }>();
const _inflight = new Map<string, Promise<TmdbMeta | null>>();
const CACHE_TTL = 60 * 60_000; // 1 hour

export async function fetchTmdbMeta(
  rawTitle: string,
  type: 'movie' | 'series',
  year?: string,
): Promise<TmdbMeta | null> {
  const k = getKey();
  if (!k) return null;
  const title = cleanTitle(rawTitle);
  if (!title) return null;

  const cacheKey = `${type}:${year ?? ''}:${title}`;

  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL) return hit.meta;

  const existing = _inflight.get(cacheKey);
  if (existing) return existing;

  const promise = _doFetch(title, type, year, k, cacheKey).finally(() => _inflight.delete(cacheKey));
  _inflight.set(cacheKey, promise);
  return promise;
}

async function _doFetch(
  title: string,
  type: 'movie' | 'series',
  year: string | undefined,
  k: string,
  cacheKey: string,
): Promise<TmdbMeta | null> {
  const mediaType = type === 'series' ? 'tv' : 'movie';
  const lang = { language: 'pt-BR' };
  const baseParams: Record<string, string> = { ...lang, query: title, page: '1' };

  const search = async (params: Record<string, string>) => {
    const res = await fetch(url(`/search/${mediaType}`, params, k), opts(k));
    if (!res.ok) return undefined;
    const data = await res.json() as { results?: SearchHit[] };
    return data.results?.[0];
  };

  let hit: SearchHit | undefined;
  try {
    // Try with year first, then fall back without year
    if (year && /^\d{4}$/.test(year)) {
      hit = await search({ ...baseParams, year });
    }
    if (!hit) {
      hit = await search(baseParams);
    }
  } catch {
    _cache.set(cacheKey, { meta: null, cachedAt: Date.now() });
    return null;
  }

  if (!hit) {
    _cache.set(cacheKey, { meta: null, cachedAt: Date.now() });
    return null;
  }

  const tmdbId = String(hit.id);
  const rawYear = (hit.release_date || hit.first_air_date || '').slice(0, 4);

  // Credits + details + videos in parallel
  const [creditsSettled, detailsSettled, videosSettled] = await Promise.allSettled([
    fetch(url(`/${mediaType}/${tmdbId}/credits`, lang, k), opts(k)),
    fetch(url(`/${mediaType}/${tmdbId}`,         lang, k), opts(k)),
    // Fetch PT-BR videos first; fall back to EN is handled below
    fetch(url(`/${mediaType}/${tmdbId}/videos`,  lang, k), opts(k)),
  ]);

  let cast = '';
  let director = '';
  if (creditsSettled.status === 'fulfilled' && creditsSettled.value.ok) {
    const credits = await creditsSettled.value.json() as Credits;
    cast = (credits.cast || []).slice(0, 6).map(c => c.name).join(', ');
    director = (credits.crew || []).find(c => c.job === 'Director')?.name
      || (credits.crew || []).find(c => c.department === 'Directing')?.name
      || '';
  }

  let genre = '';
  if (detailsSettled.status === 'fulfilled' && detailsSettled.value.ok) {
    const details = await detailsSettled.value.json() as Details;
    genre = (details.genres || []).slice(0, 3).map(g => g.name).join(', ');
  }

  // Pick the best available trailer (PT-BR official → PT-BR any → EN official → EN any)
  let trailerKey: string | undefined;
  if (videosSettled.status === 'fulfilled' && videosSettled.value.ok) {
    const vids = await videosSettled.value.json() as Videos;
    const trailers = (vids.results || []).filter(v => v.site === 'YouTube' && v.type === 'Trailer');
    trailerKey = (
      trailers.find(v => v.iso_639_1 === 'pt' && v.official) ||
      trailers.find(v => v.iso_639_1 === 'pt') ||
      trailers.find(v => v.iso_639_1 === 'en' && v.official) ||
      trailers[0]
    )?.key;

    // If PT-BR returned no results, try English as fallback
    if (!trailerKey) {
      try {
        const fallback = await fetch(
          url(`/${mediaType}/${tmdbId}/videos`, { language: 'en-US' }, k), opts(k)
        );
        if (fallback.ok) {
          const fvids = await fallback.json() as Videos;
          const fTrailers = (fvids.results || []).filter(v => v.site === 'YouTube' && v.type === 'Trailer');
          trailerKey = (fTrailers.find(v => v.official) || fTrailers[0])?.key;
        }
      } catch { /* ignore */ }
    }
  }

  const meta: TmdbMeta = {
    plot:     hit.overview || '',
    rating:   hit.vote_average ? hit.vote_average.toFixed(1) : '',
    year:     rawYear,
    genre,
    cast,
    director,
    trailerKey,
    poster:   hit.poster_path   ? `${IMG}/w500${hit.poster_path}`    : undefined,
    backdrop: hit.backdrop_path ? `${IMG}/w1280${hit.backdrop_path}` : undefined,
  };

  _cache.set(cacheKey, { meta, cachedAt: Date.now() });
  return meta;
}
