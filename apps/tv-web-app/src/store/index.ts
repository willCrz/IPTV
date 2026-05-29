import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fetchXtreamBatchEpg, fetchXmltvEpgForChannels, buildXtreamXmltvUrl } from '@/lib/epg';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/** Auto-detect XMLTV URL from an Xtream-format M3U URL (e.g. /get.php?username=X&password=Y) */
function detectXtreamXmltvFromM3uUrl(m3uUrl: string | undefined): string | undefined {
  if (!m3uUrl) return undefined;
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

// ── Types ─────────────────────────────────────────────────────
export interface Channel {
  id: string; name: string; streamUrl: string; streamUrlM3u8?: string;
  logo?: string; groupTitle?: string; num?: number; status?: string;
  contentType?: 'live'|'movie'|'series';
  rating?: string; plot?: string; year?: string;
  /** tvg-id from M3U EXTINF or epg_channel_id from Xtream — used for EPG matching */
  tvgId?: string;
  /** Xtream numeric stream_id (only for xt_ channels) — used for short EPG API */
  streamId?: string;
}
export interface Playlist {
  id: string; name: string; type: 'xtream'|'m3u';
  serverUrl?: string; username?: string; password?: string; m3uUrl?: string;
  xmltvEpgUrl?: string;
  addedAt: string;        // ISO — when the list was added
  expiresAt?: string;     // ISO — expiration date (from Xtream API or user-set)
  channelCount?: number;  // live channels loaded
  lastSync?: string;      // ISO — last successful load
}
export interface EpgProgram {
  id: string; title: string; description?: string; category?: string;
  startTime: string; endTime: string; channelId: string;
  isNow?: boolean; isPast?: boolean; progress?: number;
}
export interface CatInfo { name: string; count: number; }

export interface ContentState {
  // Categorias carregadas rapidamente
  cats: CatInfo[];
  total: number;
  catsLoaded: boolean;
  // Itens da categoria ativa
  items: Channel[];
  itemsPage: number;
  itemsTotal: number;
  itemsLoaded: boolean;
  // Busca
  searchItems: Channel[];
  searchLoaded: boolean;
}

interface Store {
  // Auth
  token: string|null;
  user: { id:string; email:string; username?:string }|null;
  playlists: Playlist[];
  isAuthenticated: boolean;
  login: (email:string, password:string) => Promise<void>;
  logout: () => void;
  addPlaylist: (p:Omit<Playlist,'addedAt'> & { addedAt?: string }) => void;
  updatePlaylist: (id:string, patch:Partial<Playlist>) => void;
  removePlaylist: (id:string) => void;

  // Conteúdo
  live:   ContentState;
  movies: ContentState;
  series: ContentState;
  counts: { live:number; movie:number; series:number };

  // Ações de carregamento
  loadCounts: () => Promise<void>;
  loadCats: (type:'live'|'movie'|'series') => Promise<void>;
  loadItems: (type:'live'|'movie'|'series', cat:string, page?:number) => Promise<void>;
  loadMore: (type:'live'|'movie'|'series', cat:string) => Promise<void>;
  searchContent: (type:'live'|'movie'|'series', q:string) => Promise<void>;
  loadAllCats: () => Promise<void>;

  // Compatibilidade legada / import local
  setLiveChannels: (chs: Channel[]) => void;
  setMovieItems: (chs: Channel[]) => void;
  setSeriesItems: (chs: Channel[]) => void;
  // Atualiza os três em uma única operação (1 re-render)
  setAllChannels: (live: Channel[], movies: Channel[], series: Channel[]) => void;
  // Mescla canais de múltiplas playlists sem apagar os existentes (dedup por id)
  mergeLiveChannels: (chs: Channel[]) => void;
  mergeChannels: (live: Channel[], movies: Channel[], series: Channel[]) => void;

  // EPG
  epgNow: Record<string, EpgProgram>;
  epgSchedule: Record<string, EpgProgram[]>;
  epgLoading: Record<string, boolean>;
  loadEpgNow: () => Promise<void>;
  getChannelEpg: (channelId:string) => Promise<EpgProgram[]>;
  loadChannelEpg: (channel: Channel) => Promise<void>;
  loadVisibleEpg: (channels: Channel[]) => void;

  // Player
  currentChannel: Channel|null;
  playerOpen: boolean;
  miniPlayer: boolean;
  setCurrentChannel: (ch:Channel|null) => void;
  playMedia: (ch:Channel) => void;
  setPlayerOpen: (v:boolean) => void;
  setMiniPlayer: (v:boolean) => void;
  closePlayer: () => void;

  // UI
  activeTab: 'live'|'movies'|'series'|'favorites'|'history'|'guide';
  activeCategory: string|null;
  searchQuery: string;
  setActiveTab: (t:Store['activeTab']) => void;
  setActiveCategory: (c:string|null) => void;
  setSearchQuery: (q:string) => void;

  // Favoritos & Histórico
  favorites: string[];
  history: Channel[];
  toggleFavorite: (id:string) => void;
  addHistory: (ch:Channel) => void;
}

function buildCats(chs: Channel[]): CatInfo[] {
  const map = new Map<string, number>();
  for (const ch of chs) map.set(ch.groupTitle || 'Geral', (map.get(ch.groupTitle || 'Geral') || 0) + 1);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

const emptyContent = (): ContentState => ({
  cats:[], total:0, catsLoaded:false,
  items:[], itemsPage:0, itemsTotal:0, itemsLoaded:false,
  searchItems:[], searchLoaded:false,
});

const typeKey = (t: string) => t === 'movie' ? 'movies' : t === 'series' ? 'series' : 'live';

// Erro especial para token inválido/expirado
class UnauthorizedError extends Error {
  constructor() { super('Sessão expirada'); this.name = 'UnauthorizedError'; }
}

// fetch com timeout
async function apiFetch(url: string, token: string, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch(e) {
    clearTimeout(t);
    throw e;
  }
}

const mapCh = (ch: Record<string,unknown>): Channel => ({
  id:   ch.id as string,
  name: ch.name as string,
  streamUrl: (ch.streamUrlM3u8 as string) || (ch.streamUrl as string),
  streamUrlM3u8: ch.streamUrlM3u8 as string|undefined,
  logo: ch.logo as string|undefined,
  groupTitle: ch.groupTitle as string|undefined,
  num:  ch.num as number|undefined,
  status: ch.status as string|undefined,
  contentType: (ch.contentType as 'live'|'movie'|'series'|undefined),
  rating: ch.rating as string|undefined,
  plot:   ch.plot as string|undefined,
  year:   ch.year as string|undefined,
  tvgId:    ch.tvgId as string|undefined,
  streamId: ch.streamId as string|undefined,
});

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      // Auth
      token:null, user:null, playlists:[], isAuthenticated:false,

      login: async (email, password) => {
        const res = await fetch(`${API}/auth/login`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email, password, deviceType:'web', deviceName:'Browser' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message||'Credenciais inválidas');
        set({ token:data.data.tokens.accessToken, user:data.data.user, isAuthenticated:true });
        await get().loadAllCats();
      },

      // Clears only auth credentials — playlists and channels are kept so
      // the user can keep watching without re-adding their list on next open.
      logout: () => set({ token:null, user:null, isAuthenticated:false, currentChannel:null }),

      addPlaylist: (p) => set(s => ({ playlists:[...s.playlists, { addedAt: new Date().toISOString(), ...p }] })),
      updatePlaylist: (id, patch) => set(s => ({ playlists: s.playlists.map(p => p.id === id ? { ...p, ...patch } : p) })),
      removePlaylist: (id) => set(s => ({ playlists:s.playlists.filter(p=>p.id!==id) })),

      // Conteúdo
      live:   emptyContent(),
      movies: emptyContent(),
      series: emptyContent(),
      counts: { live:0, movie:0, series:0 },

      // Carregar apenas categorias (rápido — sem os itens)
      loadCats: async (type) => {
        const { token } = get();
        if (!token) return;
        const key = typeKey(type);
        try {
          const data = await apiFetch(`${API}/channels/cats?type=${type}`, token);
          const { categories, total } = data.data || {};
          set(s => ({
            [key]: {
              ...(s[key as keyof Store] as ContentState),
              cats: (categories||[]) as CatInfo[],
              total: total||0,
              catsLoaded: true,
            }
          }));
        } catch(e) {
          if (e instanceof UnauthorizedError) { get().logout(); return; }
          console.error(`[Store] loadCats(${type}):`, e);
          set(s => ({ [key]: { ...(s[key as keyof Store] as ContentState), catsLoaded:true } }));
        }
      },

      // Carregar itens de uma categoria (paginado)
      loadItems: async (type, cat, page = 1) => {
        const { token } = get();
        if (!token) return;
        const key = typeKey(type);
        set(s => ({
          [key]: {
            ...(s[key as keyof Store] as ContentState),
            itemsLoaded: false,
            ...(page === 1 ? { items:[], itemsPage:0 } : {}),
          }
        }));
        try {
          const catParam = cat ? `&cat=${encodeURIComponent(cat)}` : '';
          const data = await apiFetch(
            `${API}/channels/list?type=${type}${catParam}&page=${page}&limit=48`,
            token
          );
          const { items=[], total=0, pages=1 } = data.data || {};
          const mapped = (items as Record<string,unknown>[]).map(mapCh);
          set(s => {
            const prev = (s[key as keyof Store] as ContentState);
            return {
              [key]: {
                ...prev,
                items: page === 1 ? mapped : [...prev.items, ...mapped],
                itemsPage: page,
                itemsTotal: total,
                itemsLoaded: true,
              }
            };
          });
        } catch(e) {
          if (e instanceof UnauthorizedError) { get().logout(); return; }
          console.error(`[Store] loadItems(${type}):`, e);
          set(s => ({ [key]: { ...(s[key as keyof Store] as ContentState), itemsLoaded:true } }));
        }
      },

      // Carregar próxima página
      loadMore: async (type, cat) => {
        const key = typeKey(type);
        const state = (get()[key as keyof Store] as ContentState);
        if (!state.itemsLoaded) return;
        const nextPage = state.itemsPage + 1;
        const maxPages = Math.ceil(state.itemsTotal / 48);
        if (nextPage > maxPages) return;
        await get().loadItems(type, cat, nextPage);
      },

      // Buscar
      searchContent: async (type, q) => {
        const { token } = get();
        if (!token || q.length < 2) return;
        const key = typeKey(type);
        set(s => ({ [key]: { ...(s[key as keyof Store] as ContentState), searchLoaded:false } }));
        try {
          const data = await apiFetch(
            `${API}/channels/list?type=${type}&search=${encodeURIComponent(q)}&limit=96`,
            token
          );
          const items = ((data.data?.items||[]) as Record<string,unknown>[]).map(mapCh);
          set(s => ({ [key]: { ...(s[key as keyof Store] as ContentState), searchItems:items, searchLoaded:true } }));
        } catch(e) {
          if (e instanceof UnauthorizedError) { get().logout(); return; }
          console.error(`[Store] search:`, e);
          set(s => ({ [key]: { ...(s[key as keyof Store] as ContentState), searchLoaded:true } }));
        }
      },

      // Carregar todas as categorias em paralelo (ao iniciar)
      loadAllCats: async () => {
        const { loadCats, loadCounts } = get();
        await Promise.allSettled([
          loadCounts(),
          loadCats('live'),
          loadCats('movie'),
          loadCats('series'),
        ]);
      },

      // Contagens
      loadCounts: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const data = await apiFetch(`${API}/channels/counts`, token);
          set({ counts: data.data || { live:0, movie:0, series:0 } });
        } catch(e) {
          if (e instanceof UnauthorizedError) get().logout();
        }
      },

      // Import local (Xtream / M3U)
      setLiveChannels: (chs) => {
        const cats = buildCats(chs);
        set(s => ({ live:{ cats, total:chs.length, catsLoaded:true, items:chs, itemsPage:1, itemsTotal:chs.length, itemsLoaded:true, searchItems:[], searchLoaded:false }, counts:{ ...s.counts, live:chs.length } }));
      },
      setMovieItems: (chs) => {
        const cats = buildCats(chs);
        set(s => ({ movies:{ cats, total:chs.length, catsLoaded:true, items:chs, itemsPage:1, itemsTotal:chs.length, itemsLoaded:true, searchItems:[], searchLoaded:false }, counts:{ ...s.counts, movie:chs.length } }));
      },
      setSeriesItems: (chs) => {
        const cats = buildCats(chs);
        set(s => ({ series:{ cats, total:chs.length, catsLoaded:true, items:chs, itemsPage:1, itemsTotal:chs.length, itemsLoaded:true, searchItems:[], searchLoaded:false }, counts:{ ...s.counts, series:chs.length } }));
      },
      setAllChannels: (liveChs, movieChs, seriesChs) => {
        const liveCats   = buildCats(liveChs);
        const movieCats  = buildCats(movieChs);
        const seriesCats = buildCats(seriesChs);
        set({
          live:   { cats:liveCats,   total:liveChs.length,   catsLoaded:true, items:liveChs,   itemsPage:1, itemsTotal:liveChs.length,   itemsLoaded:true, searchItems:[], searchLoaded:false },
          movies: { cats:movieCats,  total:movieChs.length,  catsLoaded:true, items:movieChs,  itemsPage:1, itemsTotal:movieChs.length,  itemsLoaded:true, searchItems:[], searchLoaded:false },
          series: { cats:seriesCats, total:seriesChs.length, catsLoaded:true, items:seriesChs, itemsPage:1, itemsTotal:seriesChs.length, itemsLoaded:true, searchItems:[], searchLoaded:false },
          counts: { live:liveChs.length, movie:movieChs.length, series:seriesChs.length },
        });
      },
      mergeLiveChannels: (chs) => {
        set(s => {
          const ids = new Set(s.live.items.map(c => c.id));
          const merged = [...s.live.items, ...chs.filter(c => !ids.has(c.id))];
          return {
            live: { cats:buildCats(merged), total:merged.length, catsLoaded:true, items:merged, itemsPage:1, itemsTotal:merged.length, itemsLoaded:true, searchItems:[], searchLoaded:false },
            counts: { ...s.counts, live:merged.length },
          };
        });
      },
      mergeChannels: (liveChs, movieChs, seriesChs) => {
        set(s => {
          const mrg = <T extends { id:string }>(existing: T[], incoming: T[]) => {
            const ids = new Set(existing.map(c => c.id));
            return [...existing, ...incoming.filter(c => !ids.has(c.id))];
          };
          const newLive   = mrg(s.live.items,   liveChs);
          const newMovies = mrg(s.movies.items, movieChs);
          const newSeries = mrg(s.series.items, seriesChs);
          return {
            live:   { cats:buildCats(newLive),   total:newLive.length,   catsLoaded:true, items:newLive,   itemsPage:1, itemsTotal:newLive.length,   itemsLoaded:true, searchItems:[], searchLoaded:false },
            movies: { cats:buildCats(newMovies), total:newMovies.length, catsLoaded:true, items:newMovies, itemsPage:1, itemsTotal:newMovies.length, itemsLoaded:true, searchItems:[], searchLoaded:false },
            series: { cats:buildCats(newSeries), total:newSeries.length, catsLoaded:true, items:newSeries, itemsPage:1, itemsTotal:newSeries.length, itemsLoaded:true, searchItems:[], searchLoaded:false },
            counts: { live:newLive.length, movie:newMovies.length, series:newSeries.length },
          };
        });
      },

      // EPG
      epgNow: {},
      epgSchedule: {},
      epgLoading: {},
      // Recomputes epgNow from the already-loaded epgSchedule — no network request needed.
      // Called on mount and every 60 s so "AGORA" highlights stay accurate as time passes.
      // Also prunes programs that ended more than 2 h ago to prevent memory growth.
      loadEpgNow: async () => {
        const { epgSchedule } = get();
        const now = Date.now();
        const cutoff = now - 2 * 3600_000;
        const map: Record<string, EpgProgram> = {};
        const pruned: Record<string, EpgProgram[]> = {};
        let didPrune = false;
        for (const [chId, progs] of Object.entries(epgSchedule)) {
          const kept = progs.filter(p => new Date(p.endTime).getTime() > cutoff);
          if (kept.length !== progs.length) { pruned[chId] = kept; didPrune = true; }
          const current = kept.find(p => {
            const s = new Date(p.startTime).getTime();
            const e = new Date(p.endTime).getTime();
            return s <= now && e > now;
          });
          if (current) map[chId] = { ...current, isNow: true, progress: Math.round((now - new Date(current.startTime).getTime()) / (new Date(current.endTime).getTime() - new Date(current.startTime).getTime()) * 100) };
        }
        if (didPrune) set({ epgNow: map, epgSchedule: { ...epgSchedule, ...pruned } });
        else set({ epgNow: map });
      },
      getChannelEpg: async (channelId) => {
        const { token } = get();
        if (!token) return [];
        try {
          const data = await apiFetch(`${API}/epg/channel/${channelId}`, token);
          return data.data||[];
        } catch(e) {
          if (e instanceof UnauthorizedError) get().logout();
          return [];
        }
      },

      loadChannelEpg: async (channel) => {
        // Delegates to loadVisibleEpg so both code paths share the same logic.
        get().loadVisibleEpg([channel]);
      },

      loadVisibleEpg: (channels) => {
        const { playlists, epgSchedule, epgLoading } = get();
        const now = Date.now();

        const toLoad = channels.filter(ch => {
          if (epgLoading[ch.id]) return false;
          const sched = epgSchedule[ch.id];
          if (!sched) return true;                           // never fetched
          if (sched.length === 0) return false;              // server confirmed no data
          // Re-fetch if all programs ended more than 30 min ago (stale data)
          return sched.every(p => new Date(p.endTime).getTime() < now - 30 * 60_000);
        });
        if (toLoad.length === 0) return;

        const markLoading: Record<string, boolean> = {};
        toLoad.forEach(ch => { markLoading[ch.id] = true; });
        set(s => ({ epgLoading: { ...s.epgLoading, ...markLoading } }));

        // Collect XMLTV EPG URLs from ALL playlists (Xtream uses /xmltv.php,
        // M3U playlists use the url-tvg header or auto-detected Xtream URL).
        // Multiple sources are tried in parallel so channels from any playlist get EPG.
        const xmltvUrls: string[] = [];
        let xtPlaylist = playlists.find(p => p.type === 'xtream' && p.serverUrl && p.username && p.password);
        for (const p of playlists) {
          if (p.type === 'xtream' && p.serverUrl && p.username && p.password) {
            const url = buildXtreamXmltvUrl(p.serverUrl, p.username, p.password);
            if (!xmltvUrls.includes(url)) xmltvUrls.push(url);
          } else if (p.type === 'm3u') {
            const url = p.xmltvEpgUrl || detectXtreamXmltvFromM3uUrl(p.m3uUrl);
            if (url && !xmltvUrls.includes(url)) xmltvUrls.push(url);
          }
        }

        const loadEpg = async () => {
          const newSchedule: Record<string, EpgProgram[]> = {};
          const newNow:      Record<string, EpgProgram>   = {};
          const clearLoad:   Record<string, boolean>       = {};

          // Step 1: try ALL XMLTV sources in parallel — uses tvgId match first,
          // then falls back to normalized channel-name matching for unmatched channels.
          if (xmltvUrls.length > 0 && toLoad.length > 0) {
            const xmltvChs = toLoad.map(ch => ({ id: ch.id, tvgId: ch.tvgId, name: ch.name }));
            const xmltvResults = await Promise.allSettled(
              xmltvUrls.map(url => fetchXmltvEpgForChannels(url, xmltvChs))
            );
            for (const result of xmltvResults) {
              if (result.status !== 'fulfilled') continue;
              const xmltvRes = result.value;
              for (const [chId, progs] of Object.entries(xmltvRes)) {
                if (newSchedule[chId] !== undefined) continue; // already matched by a prior URL
                if (progs.length > 0) {
                  newSchedule[chId] = progs;
                  const nowProg = progs.find(p => p.isNow);
                  if (nowProg) newNow[chId] = nowProg;
                }
              }
            }
          }

          // Step 2: short EPG for Xtream channels not yet covered by XMLTV.
          // Covers: channels with no tvgId, and channels whose tvgId had no XMLTV match.
          if (xtPlaylist?.serverUrl && xtPlaylist.username && xtPlaylist.password) {
            const { serverUrl, username, password } = xtPlaylist;
            const needsShort = toLoad.filter(ch =>
              ch.id.startsWith('xt_') && newSchedule[ch.id] === undefined
            );
            if (needsShort.length > 0) {
              const streamIds = needsShort.map(ch => ch.streamId || ch.id.replace('xt_', ''));
              try {
                const shortRes = await fetchXtreamBatchEpg(serverUrl, username, password, streamIds);
                for (const [key, progs] of Object.entries(shortRes)) {
                  if (newSchedule[key] === undefined) {
                    newSchedule[key] = progs;
                    const nowProg = progs.find(p => p.isNow);
                    if (nowProg) newNow[key] = nowProg;
                  }
                }
              } catch { /* short EPG failed */ }
            }
          }

          // Mark any channel that got nothing from either source as explicitly empty
          // so it isn't re-fetched on the next loadVisibleEpg call.
          toLoad.forEach(ch => {
            if (newSchedule[ch.id] === undefined) newSchedule[ch.id] = [];
          });

          toLoad.forEach(ch => { clearLoad[ch.id] = false; });
          set(s => ({
            epgSchedule: { ...s.epgSchedule, ...newSchedule },
            epgNow:      { ...s.epgNow,      ...newNow      },
            epgLoading:  { ...s.epgLoading,  ...clearLoad   },
          }));
        };

        loadEpg().catch(() => {
          const clearLoad: Record<string, boolean> = {};
          toLoad.forEach(ch => { clearLoad[ch.id] = false; });
          set(s => ({ epgLoading: { ...s.epgLoading, ...clearLoad } }));
        });
      },

      // Player
      currentChannel:null, playerOpen:false, miniPlayer:false,
      setCurrentChannel: (ch) => set({ currentChannel:ch, playerOpen:false }),
      playMedia: (ch) => set({ currentChannel:ch, playerOpen:true }),
      setPlayerOpen: (v) => set({ playerOpen:v }),
      setMiniPlayer: (v) => set({ miniPlayer:v }),
      closePlayer: () => set({ playerOpen:false, miniPlayer:false, currentChannel:null }),

      // UI
      activeTab:'live', activeCategory:null, searchQuery:'',
      setActiveTab: (t) => set({ activeTab:t, activeCategory:null, searchQuery:'' }),
      setActiveCategory: (c) => set({ activeCategory:c }),
      setSearchQuery: (q) => set({ searchQuery:q }),

      // Favoritos & Histórico
      favorites:[], history:[],
      toggleFavorite: (id) => set(s => ({
        favorites: s.favorites.includes(id) ? s.favorites.filter(f=>f!==id) : [...s.favorites,id]
      })),
      addHistory: (ch) => set(s => ({
        history: [ch, ...s.history.filter(h=>h.id!==ch.id)].slice(0,50)
      })),
    }),
    {
      name: 'iptv-v9',
      storage: createJSONStorage(()=>localStorage),
      partialize: (s) => ({
        token:s.token, user:s.user, isAuthenticated:s.isAuthenticated,
        playlists:s.playlists, favorites:s.favorites,
        history:s.history, activeTab:s.activeTab,
        // EPG persisted so the user sees "now playing" instantly on next open
        // and loadVisibleEpg skips already-loaded channels (re-fetches only stale ones)
        epgNow: s.epgNow,
        epgSchedule: s.epgSchedule,
      }),
    }
  )
);
