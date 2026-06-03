'use client';
import { useState, useEffect, useRef, memo } from 'react';
import { Play, Star, X, Layers, ChevronDown, ChevronUp, Film, Tv, Clapperboard } from 'lucide-react';
import { useStore, type Channel } from '@/store';
import { fetchTmdbMeta, cleanTitle, type TmdbMeta } from '@/lib/tmdb';

// ── Types ─────────────────────────────────────────────────────
interface XtreamEp { id: string; ep: number; title: string; streamUrl: string; }
interface XtreamSeason { season: number; episodes: XtreamEp[]; }
interface SeriesInfo {
  seasons: XtreamSeason[];
  plot: string;
  cast: string;
  genre: string;
  releaseDate: string;
  rating: string;
  backdrop: string;
}

interface MediaModalProps {
  item: Channel;
  allItems?: Channel[];
  onClose: () => void;
  onPlay: (ch: Channel) => void;
}

// ── Helpers ───────────────────────────────────────────────────
function detectAudio(name: string): 'dub' | 'leg' | 'orig' {
  const n = name.toLowerCase();
  if (/(dub|dublado|dubbed|pt.?br|ptbr|nacional)/.test(n)) return 'dub';
  if (/(leg|legendado|sub|subtitled|legend)/.test(n)) return 'leg';
  return 'orig';
}

function baseName(name: string): string {
  return name
    .replace(/\s*[-–|]?\s*(dublado|dub|legendado|leg|sub|nacional|pt\.?br|ptbr)\s*$/i, '')
    .replace(/\s*\((dublado|dub|legendado|leg)\)\s*$/i, '')
    .trim();
}

function validRating(r?: string): string {
  if (!r) return '';
  const n = parseFloat(r);
  if (isNaN(n) || n <= 0) return '';
  return n.toFixed(1);
}

// ── Fetch Xtream VOD (movie) full info ────────────────────────
interface MovieInfo {
  plot: string; cast: string; director: string; genre: string; rating: string;
  year: string;   // from releasedate field
  cover: string;  // from movie_image (TMDB poster URL)
}

async function fetchXtreamMovieInfo(server: string, user: string, pass: string, vodId: string): Promise<MovieInfo> {
  const base = server.replace(/\/$/, '');
  const upstream = `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_vod_info&vod_id=${vodId}`;
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(upstream)}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as {
    info?: {
      plot?: string; cast?: string; director?: string; genre?: string;
      rating?: string; rating_5based?: string;
      releasedate?: string; movie_image?: string; backdrop_path?: string;
    };
  };
  return {
    plot:     data.info?.plot     || '',
    cast:     data.info?.cast     || '',
    director: data.info?.director || '',
    genre:    data.info?.genre    || '',
    rating:   data.info?.rating   || data.info?.rating_5based || '',
    year:     (data.info?.releasedate || '').slice(0, 4),
    cover:    data.info?.movie_image  || data.info?.backdrop_path || '',
  };
}

// ── Fetch Xtream series info (episodes + metadata) ────────────
async function fetchXtreamSeriesInfo(url: string): Promise<SeriesInfo> {
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as {
    info?: Record<string, string>;
    episodes?: Record<string, Array<{
      id: string; episode_num: number; title?: string; container_extension?: string;
    }>>;
  };

  const info = data.info || {};
  const u = new URL(url);
  const base = u.origin;
  const user = u.searchParams.get('username') || '';
  const pass = u.searchParams.get('password') || '';

  const seasons: XtreamSeason[] = Object.entries(data.episodes || {})
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([season, eps]) => ({
      season: parseInt(season),
      episodes: eps
        .sort((a, b) => a.episode_num - b.episode_num)
        .map(ep => ({
          id: ep.id,
          ep: ep.episode_num,
          title: ep.title || `Episódio ${ep.episode_num}`,
          streamUrl: `${base}/series/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${ep.id}.${ep.container_extension || 'mp4'}`,
        })),
    }));

  return {
    seasons,
    plot: info.plot || info.description || '',
    cast: info.cast || '',
    genre: info.genre || '',
    releaseDate: info.releaseDate || info.release_date || info.releasedate || '',
    rating: validRating(info.rating || info.rating_5based),
    backdrop: info.backdrop_path || info.movie_image || '',
  };
}

// ── MediaModal ────────────────────────────────────────────────
export const MediaModal = memo(function MediaModal({ item, allItems = [], onClose, onPlay }: MediaModalProps) {
  const { favorites, toggleFavorite, playlists } = useStore();
  const modalRef = useRef<HTMLDivElement>(null);

  const isSeries  = item.contentType === 'series';
  const isMovie   = item.contentType === 'movie';
  const isFav     = favorites.includes(item.id);
  const isXtream  = item.id.startsWith('ser_') || item.id.startsWith('vod_');

  const [expandedPlot, setExpandedPlot] = useState(false);
  const [activeSeason, setActiveSeason] = useState(1);
  const [activeAudio,  setActiveAudio]  = useState<'dub' | 'leg' | 'orig'>('orig');
  const [seriesInfo,   setSeriesInfo]   = useState<SeriesInfo | null>(null);
  const [loadingEps,   setLoadingEps]   = useState(false);
  const [epsError,     setEpsError]     = useState('');
  const [movieInfo,    setMovieInfo]    = useState<MovieInfo | null>(null);
  const [loadingInfo,  setLoadingInfo]  = useState(false);
  const [tmdbMeta,     setTmdbMeta]     = useState<TmdbMeta | null>(null);
  const [trailerOpen,  setTrailerOpen]  = useState(false);

  // Find the Xtream playlist that matches this item's server
  const xtPlaylist = playlists.find(p => {
    if (p.type !== 'xtream' || !p.serverUrl) return false;
    return item.streamUrl.startsWith(p.serverUrl.replace(/\/$/, ''));
  });

  // Fetch movie full info (Xtream VOD only)
  useEffect(() => {
    if (!isMovie || !isXtream || !xtPlaylist?.serverUrl || !xtPlaylist.username || !xtPlaylist.password) return;
    const vodId = item.id.replace('vod_', '');
    setLoadingInfo(true); setMovieInfo(null);
    fetchXtreamMovieInfo(xtPlaylist.serverUrl, xtPlaylist.username, xtPlaylist.password, vodId)
      .then(setMovieInfo)
      .catch(() => {})
      .finally(() => setLoadingInfo(false));
  }, [item.id]);

  // Fetch series info (episodes + metadata) for Xtream series
  useEffect(() => {
    if (!isSeries || !isXtream) return;
    setLoadingEps(true); setSeriesInfo(null); setEpsError('');
    fetchXtreamSeriesInfo(item.streamUrl)
      .then(info => {
        setSeriesInfo(info);
        if (info.seasons.length > 0) setActiveSeason(info.seasons[0].season);
      })
      .catch(e => setEpsError(e instanceof Error ? e.message : 'Erro ao buscar informações'))
      .finally(() => setLoadingEps(false));
  }, [item.id]);

  // TMDB enrichment — runs for every item, fills gaps left by Xtream or M3U
  useEffect(() => {
    const title = cleanTitle(item.name);
    if (!title) return;
    setTmdbMeta(null);
    fetchTmdbMeta(title, isSeries ? 'series' : 'movie', item.year)
      .then(meta => { if (meta) setTmdbMeta(meta); })
      .catch(() => {});
  }, [item.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap: keep keyboard/D-pad navigation inside the modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    // Auto-focus first interactive element when modal opens
    const t = setTimeout(() => {
      const first = modal.querySelector<HTMLElement>(
        'button:not([disabled]), [tabindex="0"]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 80);
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
      )).filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (all.length < 2) return;
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    modal.addEventListener('keydown', trapFocus);
    return () => { clearTimeout(t); modal.removeEventListener('keydown', trapFocus); };
  }, []);

  // Close trailer on TV remote Back key
  useEffect(() => {
    const onBack = (e: Event) => {
      if (trailerOpen) { e.stopImmediatePropagation(); setTrailerOpen(false); }
    };
    document.addEventListener('tv:back', onBack, true);
    return () => document.removeEventListener('tv:back', onBack, true);
  }, [trailerOpen]);

  // Audio variants for movies
  const base = baseName(item.name);
  const variants = isMovie
    ? [item, ...allItems.filter(c => c.id !== item.id && baseName(c.name) === base && c.contentType === 'movie')]
        .map(ch => ({ ch, audio: detectAudio(ch.name) }))
        .filter((v, i, arr) => arr.findIndex(x => x.audio === v.audio) === i)
    : [];

  useEffect(() => {
    if (variants.length > 0) {
      const dub = variants.find(v => v.audio === 'dub');
      setActiveAudio(dub ? 'dub' : variants[0].audio);
    }
  }, [item.id]);

  const selectedVariant = variants.find(v => v.audio === activeAudio) || variants[0];
  const playTarget = selectedVariant?.ch || item;

  const audioLabel = { dub: 'Dublado', leg: 'Legendado', orig: 'Original' };
  const audioIcon  = { dub: '🔊', leg: '💬', orig: '🌐' };

  const seasons = seriesInfo?.seasons || [];
  const activeSeasonData = seasons.find(s => s.season === activeSeason) || seasons[0];

  // Displayed plot: Xtream detailed API → TMDB → list-level field (priority order)
  const plot = isSeries
    ? (seriesInfo?.plot || tmdbMeta?.plot || item.plot || '')
    : (movieInfo?.plot  || tmdbMeta?.plot || item.plot || '');
  const displayRating   = validRating(
    (isSeries ? seriesInfo?.rating : movieInfo?.rating) || tmdbMeta?.rating || item.rating
  );
  const displayGenre    = (isSeries ? seriesInfo?.genre : movieInfo?.genre)
    || tmdbMeta?.genre || item.groupTitle || '';
  const displayCast     = (isSeries ? seriesInfo?.cast  : movieInfo?.cast)  || tmdbMeta?.cast     || '';
  const displayDirector = (!isSeries ? movieInfo?.director : '')             || tmdbMeta?.director || '';
  const isLoadingMeta   = (isSeries && loadingEps) || (isMovie && loadingInfo);

  const makeEpChannel = (ep: XtreamEp): Channel => ({
    id: `ep_${ep.id}`,
    name: `${base} — S${String(activeSeason).padStart(2, '0')}E${String(ep.ep).padStart(2, '0')} ${ep.title}`,
    streamUrl: ep.streamUrl,
    contentType: 'series',
    logo: item.logo,
  });

  const handleWatch = () => {
    if (isSeries) {
      // Non-Xtream series: play directly
      if (!isXtream) { onPlay(item); return; }
      // Xtream series: play first episode of active season
      const first = activeSeasonData?.episodes[0];
      if (first) onPlay(makeEpChannel(first));
    } else {
      onPlay(playTarget);
    }
  };

  // Year: prefer Xtream vod_info (has releasedate) → TMDB → channel field (skip "0")
  const displayYear =
    (isSeries ? (seriesInfo?.releaseDate || '').slice(0, 4) : movieInfo?.year)
    || tmdbMeta?.year
    || (item.year && item.year !== '0' ? item.year : '');

  const backdropSrc = (isSeries ? seriesInfo?.backdrop : movieInfo?.cover)
    || tmdbMeta?.backdrop
    || tmdbMeta?.poster
    || item.logo;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div ref={modalRef} style={{ background: '#111118', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 20, width: '100%', maxWidth: 900, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 40px 120px rgba(0,0,0,0.95)' }}>

        {/* ── Hero banner ── */}
        <div style={{ position: 'relative', height: 300, flexShrink: 0, overflow: 'hidden', background: '#080810' }}>
          {/* Blurred backdrop */}
          {backdropSrc && (
            <img src={backdropSrc} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(22px) brightness(0.22)', transform: 'scale(1.12)', pointerEvents: 'none' }} />
          )}
          {/* Gradients */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(8,8,16,0.98) 0%, rgba(8,8,16,0.8) 45%, rgba(8,8,16,0.15) 100%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(17,17,24,1) 0%, transparent 55%)', pointerEvents: 'none' }} />

          {/* Close button */}
          <button onClick={onClose}
            style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4 }}>
            <X size={16} />
          </button>

          {/* Right: poster */}
          {item.logo && (
            <div style={{ position: 'absolute', right: 32, top: '50%', transform: 'translateY(-50%)', height: '80%', aspectRatio: '2/3', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 50px rgba(0,0,0,0.85)', zIndex: 2 }}>
              <img src={item.logo} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="eager" />
            </div>
          )}

          {/* Left: info + actions */}
          <div style={{ position: 'absolute', left: 28, bottom: 24, top: 20, right: item.logo ? '32%' : 28, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 3 }}>
            {/* Badges */}
            <div style={{ display: 'flex', gap: 7, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(108,99,255,0.22)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(108,99,255,0.4)', borderRadius: 6, padding: '3px 10px', color: '#a8a2ff', fontSize: 11, fontWeight: 700 }}>
                {isMovie ? <Film size={11} /> : <Tv size={11} />}
                {isMovie ? 'FILME' : 'SÉRIE'}
              </span>
              {displayYear && <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{displayYear}</span>}
              {displayRating && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#fbbf24', fontSize: 12, fontWeight: 600 }}>
                  <Star size={11} fill="#fbbf24" /> {displayRating}
                </span>
              )}
              {displayGenre && <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{displayGenre}</span>}
              {seasons.length > 0 && (
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                  {seasons.length} temporada{seasons.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Title */}
            <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 24, lineHeight: 1.15, marginBottom: 10, letterSpacing: '-0.01em' }}>{base}</h1>

            {/* Audio variants */}
            {variants.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {variants.map(v => (
                  <button key={v.audio} onClick={() => setActiveAudio(v.audio)}
                    style={{ padding: '5px 12px', borderRadius: 20, borderWidth: '1px', borderStyle: 'solid', borderColor: activeAudio === v.audio ? 'rgba(108,99,255,0.7)' : 'rgba(255,255,255,0.14)', background: activeAudio === v.audio ? 'rgba(108,99,255,0.22)' : 'rgba(255,255,255,0.05)', color: activeAudio === v.audio ? '#a8a2ff' : 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
                    {audioIcon[v.audio]} {audioLabel[v.audio]}
                  </button>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {/* Watch button */}
              {(!isSeries || !isXtream || seasons.length > 0 || epsError) && (
                <button
                  onClick={handleWatch}
                  disabled={isSeries && isXtream && loadingEps}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '10px 22px', fontWeight: 800, fontSize: 13, cursor: loadingEps ? 'not-allowed' : 'pointer', opacity: loadingEps ? 0.5 : 1, fontFamily: 'var(--font-sans)' }}>
                  <Play size={15} fill="#000" />
                  {isSeries
                    ? (isXtream && seasons.length > 0 ? `Assistir T${activeSeason}E1` : 'Assistir')
                    : (variants.length > 1 ? `Assistir ${audioLabel[activeAudio]}` : 'Assistir')}
                </button>
              )}

              {/* Save to favorites */}
              <button onClick={() => toggleFavorite(item.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: isFav ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.07)', borderWidth: '1px', borderStyle: 'solid', borderColor: isFav ? '#fbbf24' : 'rgba(255,255,255,0.15)', color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.8)', borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                <Star size={14} fill={isFav ? '#fbbf24' : 'none'} />
                {isFav ? 'Salvo' : 'Salvar'}
              </button>

              {/* Trailer button — only when TMDB has a YouTube key */}
              {tmdbMeta?.trailerKey && (
                <button onClick={() => setTrailerOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.15)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 10, padding: '10px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  <Clapperboard size={14} />
                  Ver Trailer
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="scrollbar-hide" style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 28px' }}>

          {/* Synopsis */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <h3 style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Sinopse</h3>
              {plot && tmdbMeta && (plot === tmdbMeta.plot) && (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(1,180,228,0.8)', background: 'rgba(1,180,228,0.1)', border: '1px solid rgba(1,180,228,0.25)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.06em' }}>TMDB</span>
              )}
            </div>
            {plot ? (
              <>
                <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 1.75, display: expandedPlot ? 'block' : '-webkit-box', WebkitLineClamp: expandedPlot ? undefined : 4, WebkitBoxOrient: 'vertical' as const, overflow: expandedPlot ? 'visible' : 'hidden' }}>
                  {plot}
                </p>
                {plot.length > 160 && (
                  <button onClick={() => setExpandedPlot(v => !v)}
                    style={{ background: 'none', border: 'none', color: '#a8a2ff', cursor: 'pointer', fontSize: 13, marginTop: 6, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {expandedPlot ? <><ChevronUp size={13} /> Menos</> : <><ChevronDown size={13} /> Ver tudo</>}
                  </button>
                )}
              </>
            ) : isLoadingMeta ? (
              <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14, fontStyle: 'italic' }}>Carregando informações...</p>
            ) : (
              <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14, fontStyle: 'italic' }}>Sinopse não disponível para este título.</p>
            )}
          </div>

          {/* Cast / Director (if available) */}
          {(displayCast || displayDirector) && (
            <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {displayDirector && (
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 600 }}>Direção: </span>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{displayDirector}</span>
                </div>
              )}
              {displayCast && (
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 600 }}>Elenco: </span>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{displayCast}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Series: season + episode selector ── */}
          {isSeries && (
            <div>
              <h3 style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
                Episódios
                {seasons.length > 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400, fontSize: 12, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                    {seasons.reduce((s, g) => s + g.episodes.length, 0)} ep.
                  </span>
                )}
              </h3>

              {loadingEps ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '28px 0' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid rgba(108,99,255,0.2)', borderTopColor: '#6c63ff', animation: 'spin 0.75s linear infinite', flexShrink: 0 }} />
                  <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Carregando episódios...</p>
                </div>
              ) : epsError ? (
                <div style={{ padding: '20px 0' }}>
                  <p style={{ color: '#f87171', fontSize: 13, marginBottom: 14 }}>{epsError}</p>
                  <button onClick={() => onPlay(item)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#6c63ff', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    <Play size={13} fill="#fff" /> Assistir mesmo assim
                  </button>
                </div>
              ) : !isXtream ? (
                // Non-Xtream series: no episode list available
                <div style={{ padding: '16px 0', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
                  <p>Selecione "Assistir" para reproduzir este título.</p>
                </div>
              ) : seasons.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                  <Layers size={28} style={{ margin: '0 auto 10px', opacity: 0.2, display: 'block' }} />
                  <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Nenhum episódio encontrado</p>
                  <button onClick={() => onPlay(item)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, background: '#6c63ff', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    <Play size={13} fill="#fff" /> Assistir mesmo assim
                  </button>
                </div>
              ) : (
                <>
                  {/* Season tabs */}
                  {seasons.length > 1 && (
                    <div className="scrollbar-hide" style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
                      {seasons.map(s => (
                        <button key={s.season} onClick={() => setActiveSeason(s.season)}
                          style={{ padding: '6px 16px', borderRadius: 999, border: 'none', flexShrink: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: activeSeason === s.season ? '#fff' : 'rgba(255,255,255,0.08)', color: activeSeason === s.season ? '#0A0B0F' : 'rgba(255,255,255,0.55)', transition: 'all 0.14s', fontFamily: 'var(--font-sans)' }}>
                          Temporada {s.season}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Episode list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(activeSeasonData?.episodes || []).map(ep => (
                      <div key={ep.id}
                        onClick={() => onPlay(makeEpChannel(ep))}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.07)', cursor: 'pointer', transition: 'background 0.14s' }}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(108,99,255,0.12)'}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'}>
                        <div style={{ width: 70, height: 42, borderRadius: 7, background: 'rgba(255,255,255,0.06)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Play size={16} color="rgba(255,255,255,0.25)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 8, fontFamily: 'monospace', fontSize: 12 }}>E{String(ep.ep).padStart(2, '0')}</span>
                            {ep.title}
                          </p>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); onPlay(makeEpChannel(ep)); }}
                          style={{ width: 34, height: 34, borderRadius: '50%', background: '#6c63ff', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Play size={13} fill="#fff" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Trailer overlay ── */}
      {trailerOpen && tmdbMeta?.trailerKey && (
        <div
          onClick={() => setTrailerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          {/* Header */}
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Clapperboard size={16} color="#f87171"/>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Trailer — {base}</span>
            </div>
            <button
              onClick={() => setTrailerOpen(false)}
              style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16}/>
            </button>
          </div>

          {/* YouTube iframe */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 900, aspectRatio: '16/9', borderRadius: 14, overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.9)' }}>
            <iframe
              src={`https://www.youtube.com/embed/${tmdbMeta.trailerKey}?autoplay=1&rel=0&modestbranding=1`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          </div>

          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 16 }}>
            Clique fora do vídeo ou pressione Voltar para fechar
          </p>
        </div>
      )}
    </div>
  );
});
