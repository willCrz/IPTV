import type { Channel } from '@/store';

export interface Movie { id:string; name:string; streamUrl:string; logo?:string; categoryId?:string; rating?:string; }

export interface XtreamAllContent {
  live: Channel[];
  movies: Channel[];
  series: Channel[];
}

// ── Xtream Codes ────────────────────────────────────────────

export async function authXtream(serverUrl: string, username: string, password: string): Promise<void> {
  const base = normalizeUrl(serverUrl);
  const url = `${base}/player_api.php?username=${enc(username)}&password=${enc(password)}`;
  let res: Response;
  try { res = await fetchWithTimeout(url, 15000); }
  catch (e) { throw new Error(`Não foi possível conectar ao servidor. Verifique a URL.\n(${(e as Error).message})`); }
  if (!res.ok) throw new Error(`Servidor retornou erro ${res.status}. Verifique a URL.`);
  let data: { user_info?: { auth?: number; status?: string } };
  try { data = await res.json(); }
  catch { throw new Error('Resposta inválida do servidor. Verifique se a URL é de um painel Xtream Codes.'); }
  if (!data.user_info) throw new Error('Servidor não reconheceu as credenciais. Confirme usuário e senha.');
  if (data.user_info.auth !== 1) {
    const status = data.user_info.status || 'desconhecido';
    throw new Error(`Acesso negado. Status da conta: ${status}`);
  }
}

export async function loadXtreamLive(serverUrl: string, username: string, password: string): Promise<Channel[]> {
  const base = normalizeUrl(serverUrl);
  const mk = (action?: string) =>
    `${base}/player_api.php?username=${enc(username)}&password=${enc(password)}${action ? `&action=${action}` : ''}`;

  let authRes: Response, catRes: Response;
  try {
    [authRes, catRes] = await Promise.all([
      fetchWithTimeout(mk(), 15000),
      fetchWithTimeout(mk('get_live_categories'), 15000),
    ]);
  } catch (e) { throw new Error(`Não foi possível conectar ao servidor.\n(${(e as Error).message})`); }

  if (!authRes.ok) throw new Error(`Servidor retornou erro ${authRes.status}.`);
  const authData = await authRes.json() as { user_info?: { auth?: number; status?: string } };
  if (!authData.user_info) throw new Error('Servidor não reconheceu as credenciais.');
  if (authData.user_info.auth !== 1)
    throw new Error(`Acesso negado. Status: ${authData.user_info.status || 'desconhecido'}`);

  const categories = catRes.ok ? (await catRes.json() as Array<{ category_id: string; category_name: string }>) : [];
  const catMap = new Map(categories.map(c => [c.category_id, c.category_name]));

  const chRes = await fetchWithTimeout(mk('get_live_streams'), 20000);
  if (!chRes.ok) throw new Error(`Erro ao carregar canais: HTTP ${chRes.status}`);
  const data = await chRes.json() as XtreamLiveStream[];
  if (!Array.isArray(data)) throw new Error('Formato de resposta inesperado.');

  return data.map((s, i) => ({
    id: `xt_${s.stream_id}`,
    streamId: String(s.stream_id),
    name: s.name,
    streamUrl: `${base}/live/${enc(username)}/${enc(password)}/${s.stream_id}.ts`,
    streamUrlM3u8: `${base}/live/${enc(username)}/${enc(password)}/${s.stream_id}.m3u8`,
    logo: s.stream_icon || '',
    groupTitle: catMap.get(s.category_id || '') || 'Geral',
    num: s.num || i + 1,
    contentType: 'live' as const,
    tvgId: s.epg_channel_id || undefined,
  }));
}

// Xtream API types
type XtreamLiveStream = {
  stream_id: number; name: string; stream_icon?: string;
  category_id?: string; num?: number; epg_channel_id?: string;
};
type XtreamVodStream = {
  stream_id: number; name: string; stream_icon?: string;
  category_id?: string; container_extension?: string;
  rating?: string; plot?: string; year?: string;
};
type XtreamSeriesItem = {
  series_id: number; name: string; cover?: string;
  category_id?: string; rating?: string; plot?: string; year?: string;
};

export interface XtreamLoadOptions {
  onProgress?: (step: string) => void;
  /** Called as soon as live channels are parsed — before movies/series finish. */
  onLiveReady?: (live: Channel[]) => void;
}

// Carrega tudo: live + filmes + séries com carregamento progressivo e parsing paralelo.
// Live channels são entregues via onLiveReady assim que chegam, sem esperar filmes/séries.
export async function loadXtreamAll(
  serverUrl: string,
  username: string,
  password: string,
  onProgressOrOpts?: ((step: string) => void) | XtreamLoadOptions,
  onLiveReadyLegacy?: (live: Channel[]) => void,
): Promise<XtreamAllContent> {
  // Suporta assinatura legada loadXtreamAll(url, u, p, onProgress) e nova com objeto
  const opts: XtreamLoadOptions = typeof onProgressOrOpts === 'function'
    ? { onProgress: onProgressOrOpts, onLiveReady: onLiveReadyLegacy }
    : (onProgressOrOpts ?? {});
  const { onProgress, onLiveReady } = opts;

  const base = normalizeUrl(serverUrl);
  const mk = (action?: string) =>
    `${base}/player_api.php?username=${enc(username)}&password=${enc(password)}${action ? `&action=${action}` : ''}`;

  onProgress?.('Verificando credenciais e carregando categorias...');

  // Fase 1: auth + todas as categorias em paralelo
  type CatArr = Array<{ category_id: string; category_name: string }>;
  let authRes: Response, liveCatRes: Response, vodCatRes: Response, seriesCatRes: Response;
  try {
    [authRes, liveCatRes, vodCatRes, seriesCatRes] = await Promise.all([
      fetchWithTimeout(mk(), 15000),
      fetchWithTimeout(mk('get_live_categories'), 15000),
      fetchWithTimeout(mk('get_vod_categories'), 15000),
      fetchWithTimeout(mk('get_series_categories'), 15000),
    ]);
  } catch (e) { throw new Error(`Não foi possível conectar ao servidor.\n(${(e as Error).message})`); }

  if (!authRes.ok) throw new Error(`Servidor retornou erro ${authRes.status}.`);
  const authData = await authRes.json() as { user_info?: { auth?: number; status?: string } };
  if (!authData.user_info) throw new Error('Servidor não reconheceu as credenciais.');
  if (authData.user_info.auth !== 1)
    throw new Error(`Acesso negado. Status: ${authData.user_info.status || 'desconhecido'}`);

  // Parse category maps in parallel
  const [liveCats, vodCats, seriesCats] = await Promise.all([
    liveCatRes.ok   ? liveCatRes.json()   as Promise<CatArr> : Promise.resolve([] as CatArr),
    vodCatRes.ok    ? vodCatRes.json()    as Promise<CatArr> : Promise.resolve([] as CatArr),
    seriesCatRes.ok ? seriesCatRes.json() as Promise<CatArr> : Promise.resolve([] as CatArr),
  ]);

  const liveCatMap   = new Map(liveCats.map(c   => [c.category_id, c.category_name]));
  const vodCatMap    = new Map(vodCats.map(c    => [c.category_id, c.category_name]));
  const seriesCatMap = new Map(seriesCats.map(c => [c.category_id, c.category_name]));

  onProgress?.('Carregando canais...');

  // Fase 2: inicia os 3 downloads em paralelo imediatamente
  const liveP   = fetchWithTimeout(mk('get_live_streams'), 30000);
  const vodP    = fetchWithTimeout(mk('get_vod_streams'),  30000);
  const seriesP = fetchWithTimeout(mk('get_series'),       30000);

  // Processa live assim que chegar (geralmente o menor e mais rápido)
  const liveRes = await liveP;
  const liveRaw = (liveRes.ok ? await liveRes.json() : []) as XtreamLiveStream[];
  const live: Channel[] = Array.isArray(liveRaw) ? liveRaw.map((s, i) => ({
    id: `xt_${s.stream_id}`,
    streamId: String(s.stream_id),
    name: s.name,
    streamUrl: `${base}/live/${enc(username)}/${enc(password)}/${s.stream_id}.ts`,
    streamUrlM3u8: `${base}/live/${enc(username)}/${enc(password)}/${s.stream_id}.m3u8`,
    logo: s.stream_icon || '',
    groupTitle: liveCatMap.get(s.category_id || '') || 'Geral',
    num: s.num || i + 1,
    contentType: 'live' as const,
    tvgId: s.epg_channel_id || undefined,
  })) : [];

  // Entrega os canais ao vivo imediatamente — sem esperar filmes/séries
  onProgress?.(`${live.length} canais carregados. Processando filmes e séries...`);
  onLiveReady?.(live);

  // Espera vod e series (já estavam baixando em paralelo) e faz parsing em paralelo
  const [vodRes, seriesRes] = await Promise.all([vodP, seriesP]);
  const [vodRaw, seriesRaw] = await Promise.all([
    vodRes.ok    ? vodRes.json()    : Promise.resolve([]),
    seriesRes.ok ? seriesRes.json() : Promise.resolve([]),
  ]) as [XtreamVodStream[], XtreamSeriesItem[]];

  const movies: Channel[] = Array.isArray(vodRaw) ? vodRaw.map((m, i) => ({
    id: `vod_${m.stream_id}`,
    streamId: String(m.stream_id),
    name: m.name,
    streamUrl: `${base}/movie/${enc(username)}/${enc(password)}/${m.stream_id}.${m.container_extension || 'mp4'}`,
    logo: m.stream_icon || '',
    groupTitle: vodCatMap.get(m.category_id || '') || 'Geral',
    num: i + 1,
    contentType: 'movie' as const,
    rating: m.rating,
    plot: m.plot,
    year: m.year,
  })) : [];

  const series: Channel[] = Array.isArray(seriesRaw) ? seriesRaw.map((s, i) => ({
    id: `ser_${s.series_id}`,
    streamId: String(s.series_id),
    name: s.name,
    streamUrl: `${base}/player_api.php?username=${enc(username)}&password=${enc(password)}&action=get_series_info&series_id=${s.series_id}`,
    logo: s.cover || '',
    groupTitle: seriesCatMap.get(s.category_id || '') || 'Geral',
    num: i + 1,
    contentType: 'series' as const,
    rating: s.rating,
    plot: s.plot,
    year: s.year,
  })) : [];

  return { live, movies, series };
}

export async function loadXtreamMovies(serverUrl: string, username: string, password: string): Promise<Movie[]> {
  const base = normalizeUrl(serverUrl);
  const res = await fetchWithTimeout(
    `${base}/player_api.php?username=${enc(username)}&password=${enc(password)}&action=get_vod_streams`,
    20000
  );
  if (!res.ok) return [];
  const data = await res.json() as Array<{ stream_id: number; name: string; stream_icon?: string; category_id?: string; rating?: string; container_extension?: string }>;
  if (!Array.isArray(data)) return [];
  return data.map(m => ({
    id: `vod_${m.stream_id}`,
    name: m.name,
    streamUrl: `${base}/movie/${enc(username)}/${enc(password)}/${m.stream_id}.${m.container_extension || 'mp4'}`,
    logo: m.stream_icon || '',
    categoryId: m.category_id,
    rating: m.rating,
  }));
}

// ── M3U Parser ──────────────────────────────────────────────

export interface M3UResult {
  channels: Channel[];
  categories: string[];
  /** XMLTV EPG URL found in M3U header (url-tvg / x-tvg-url) */
  tvgUrl?: string;
}

export async function parseM3UFromUrl(url: string): Promise<M3UResult> {
  let res: Response;
  try { res = await fetchWithTimeout(url, 20000); }
  catch (e) { throw new Error(`Não foi possível baixar a lista M3U.\n(${(e as Error).message})`); }
  if (!res.ok) throw new Error(`Erro ${res.status} ao baixar a lista M3U.`);
  const text = await res.text();
  if (!text.includes('#EXTM3U') && !text.includes('#EXTINF'))
    throw new Error('Arquivo não parece ser uma lista M3U válida.');
  const result = parseM3UText(text);
  // If no url-tvg was found in the M3U header, auto-detect from Xtream-format URL.
  if (!result.tvgUrl) result.tvgUrl = detectXtreamXmltvFromM3uUrl(url);
  return result;
}

/** Detect XMLTV URL from an Xtream-format M3U URL (e.g. /get.php?username=X&password=Y) */
function detectXtreamXmltvFromM3uUrl(m3uUrl: string): string | undefined {
  try {
    const u = new URL(m3uUrl);
    if (u.pathname === '/get.php') {
      const username = u.searchParams.get('username');
      const password = u.searchParams.get('password');
      if (username && password)
        return `${u.origin}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    }
  } catch { /* ignore invalid URLs */ }
  return undefined;
}

export function parseM3UText(text: string): M3UResult {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];

  // ── Linha de header: #EXTM3U url-tvg="..." x-tvg-url="..." ──
  let tvgUrl: string | undefined;
  if (lines[0]?.startsWith('#EXTM3U')) {
    const headerAttrs = parseAttrs(lines[0]);
    tvgUrl = headerAttrs['url-tvg'] || headerAttrs['x-tvg-url'] || undefined;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;

    const attrs = parseAttrs(line);
    const nameMatch = line.match(/,(.+)$/);
    const name = nameMatch ? nameMatch[1].trim() : 'Canal';

    // URL: primeira linha não-vazia e não-comentário após #EXTINF
    let streamUrl = '';
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith('#')) { streamUrl = l; break; }
    }
    if (!streamUrl) continue;

    const groupTitle = attrs['group-title'] || 'Geral';
    const tvgId = attrs['tvg-id'] || attrs['tvgid'] || undefined;

    channels.push({
      id: `m3u_${channels.length}`,
      name,
      streamUrl,
      logo: attrs['tvg-logo'] || attrs['logo'] || '',
      groupTitle,
      num: attrs['tvg-chno'] ? parseInt(attrs['tvg-chno']) : channels.length + 1,
      contentType: detectM3uContentType(groupTitle, name, attrs['tvg-type'] || attrs['type']),
      tvgId,
    });
  }

  const categories = [...new Set(channels.map(c => c.groupTitle || 'Geral'))].sort();
  return { channels, categories, tvgUrl };
}

/** Parse key="value" pairs from a string (case-insensitive keys) */
function parseAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\S+?)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

function detectM3uContentType(group: string, name: string, tvgType?: string): 'live' | 'movie' | 'series' {
  if (tvgType) {
    const t = tvgType.toLowerCase();
    if (t === 'movie' || t === 'vod') return 'movie';
    if (t === 'series' || t === 'serie' || t === 'tvshow') return 'series';
  }
  const g = group.toLowerCase();
  const n = name.toLowerCase();
  // Match VOD/movie groups
  if (/\b(film|filme|movie|vod|cine|cinema)\b/.test(g)) return 'movie';
  // Match series groups (includes "S01E02" pattern in name)
  if (/\b(s[eé]rie|series|temporada|season|tvshow|show)\b/.test(g)) return 'series';
  // Detect episode format in name: S01E02, 1x02, etc.
  if (/\bS\d{2}E\d{2}\b/i.test(n) || /\b\d{1,2}x\d{2}\b/.test(n)) return 'series';
  return 'live';
}

// ── Helpers ─────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'http://' + u;
  return u.replace(/\/$/, '');
}

function enc(s: string): string { return encodeURIComponent(s); }

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'IPTV-Pro/1.0', 'Accept': 'application/json, text/plain, */*' },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Timeout de ${ms/1000}s. Servidor não respondeu.`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
