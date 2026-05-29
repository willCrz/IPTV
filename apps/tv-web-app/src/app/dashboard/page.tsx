'use client';
import {
  useState, useEffect, useMemo, memo, useCallback,
  Suspense, lazy, useRef,
} from 'react';
import {
  Search, Play, Star, Tv, Film, Layers,
  MonitorPlay, Clock, ChevronDown,
  Maximize, CheckCircle,
  AlertCircle, Loader, X, Plus, Trash2,
  Bell, Settings, Heart, LayoutGrid, ArrowLeft, CalendarDays, Calendar, RefreshCw,
} from 'lucide-react';
import { useStore, type Channel, type EpgProgram, type Playlist } from '@/store';
import { parseM3UFromUrl, loadXtreamAll } from '@/lib/m3u';
import { saveChannelCache, loadChannelCache, clearChannelCache } from '@/lib/channel-cache';

/** Deduplicate channels by id, keeping first occurrence. */
function dedup(chs: Channel[]): Channel[] {
  const seen = new Set<string>();
  return chs.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
}

/** Fetch a single playlist from the server (no cache). Returns live/movies/series. */
async function fetchPlaylistContent(
  p: Playlist,
  onProgress?: (msg: string) => void,
  onLiveReady?: (live: Channel[]) => void,
): Promise<{ live: Channel[]; movies: Channel[]; series: Channel[] }> {
  if (p.type === 'xtream' && p.serverUrl && p.username && p.password) {
    return loadXtreamAll(p.serverUrl, p.username, p.password, { onProgress, onLiveReady });
  } else if (p.type === 'm3u' && p.m3uUrl) {
    onProgress?.('Baixando lista M3U...');
    const { channels } = await parseM3UFromUrl(p.m3uUrl, p.id);
    const lch = channels.filter(c => !c.contentType || c.contentType === 'live');
    const mch = channels.filter(c => c.contentType === 'movie');
    const sch = channels.filter(c => c.contentType === 'series');
    return { live: lch.length > 0 ? lch : channels, movies: mch, series: sch };
  }
  return { live: [], movies: [], series: [] };
}
import { MiniPlayer } from '@/components/player/MiniPlayer';
import { StreamLoader } from '@/lib/stream-loader';
import { MediaGrid } from '@/components/media/MediaGrid';
import { MediaModal } from '@/components/media/MediaModal';
import EpgGrid from '@/components/epg/EpgGrid';

const FullPlayerComp = lazy(() =>
  import('@/components/player/FullPlayer').then(m => ({ default: m.FullPlayer }))
);

// Pre-warm: kick off the FullPlayer bundle fetch immediately so it's ready
// before the user clicks Assistir — eliminates the 1-3s lazy-load freeze.
if (typeof window !== 'undefined') {
  import('@/components/player/FullPlayer').catch(() => {});
}

// ── Input com label ───────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text', disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean;
}) {
  // TV browsers (Titanos / Android TV WebView) don't open the native keyboard
  // on click unless focus() is called explicitly in the event handler.
  const inputMode = type === 'email' ? 'email' : type === 'url' ? 'url' : 'text';
  return (
    <div>
      <label style={{ color: 'var(--fg-3)', fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        inputMode={inputMode as React.HTMLAttributes<HTMLInputElement>['inputMode']}
        autoComplete="on" autoCorrect="off" spellCheck={false}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          background: 'var(--bg-1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--line-2)',
          color: 'var(--fg-1)', fontSize: 14, outline: 'none',
          transition: 'border-color 160ms', opacity: disabled ? 0.6 : 1, boxSizing: 'border-box',
          fontFamily: 'var(--font-sans)',
        }}
        onClick={e => { if (!disabled) e.currentTarget.focus(); }}
        onFocus={e => e.currentTarget.style.borderColor = 'var(--amber-500)'}
        onBlur={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
      />
    </div>
  );
}

// ── Poster card (filmes/séries no rail) ──────────────────────
const PosterCard = memo(function PosterCard({ ch, isCurrent, onPlay, onFav, isFav }: {
  ch: Channel; isCurrent: boolean; isFav: boolean;
  onPlay: (c: Channel) => void; onFav: (id: string) => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className="lk-poster"
      tabIndex={0}
      role="button"
      onClick={() => onPlay(ch)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onFocus={() => setHov(true)}
      onBlur={() => setHov(false)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(ch); } }}
    >
      <div className="img" style={{ outline: isCurrent ? '2px solid var(--amber-500)' : 'none', outlineOffset: 2 }}>
        {ch.logo
          ? <img src={ch.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy"/>
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-3)' }}>
              {ch.contentType === 'movie' ? <Film size={28} color="var(--fg-4)"/> : <Layers size={28} color="var(--fg-4)"/>}
            </div>}
        {hov && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={16} color="#000" fill="#000"/>
            </div>
          </div>
        )}
        {ch.rating && (
          <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.8)', color: '#FFC768', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
            ★ {ch.rating}
          </div>
        )}
        <button
          onClick={e => { e.stopPropagation(); onFav(ch.id); }}
          style={{ position: 'absolute', top: 6, left: 6, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', cursor: 'pointer', display: hov || isFav ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', color: isFav ? 'var(--amber-500)' : 'var(--fg-2)' }}>
          <Heart size={12} fill={isFav ? 'var(--amber-500)' : 'none'}/>
        </button>
      </div>
      <div className="poster-title">{ch.name}</div>
      <div className="poster-meta">{ch.groupTitle}{ch.year ? ` · ${ch.year}` : ''}</div>
    </div>
  );
});

// ── Logo com fallback de texto ao falhar ──────────────────
function LogoImg({ src, name, size = 4 }: { src?: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  const initials = name.slice(0, 3).toUpperCase();
  if (!src || err) {
    return <span style={{ fontSize: size === 4 ? 10 : 9, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1 }}>{initials}</span>;
  }
  return (
    <img
      src={src} alt=""
      style={{ width: '100%', height: '100%', objectFit: 'contain', padding: size === 4 ? 3 : 2 }}
      loading="lazy" decoding="async"
      onError={() => setErr(true)}
    />
  );
}

// ── Channel tile (Live TV) ─────────────────────────────────
const ChannelTile = memo(function ChannelTile({ ch, isActive, epgTitle, onPlay }: {
  ch: Channel; isActive: boolean; epgTitle?: string; onPlay: (c: Channel) => void;
}) {
  return (
    <div
      className={'lk-channel' + (isActive ? ' active' : '')}
      onClick={() => onPlay(ch)}
      tabIndex={0}
      role="button"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(ch); } }}
    >
      {ch.num !== undefined && (
        <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, width: 26, textAlign: 'right', lineHeight: 1 }}>
          {String(ch.num).padStart(3, '0')}
        </span>
      )}
      <div className="ch-logo">
        <LogoImg src={ch.logo} name={ch.name}/>
      </div>
      <div className="ch-info">
        <div className="ch-name">{ch.name}</div>
        <div className="ch-now">{epgTitle || ch.groupTitle}</div>
        <div className="ch-live"><span className="lk-live-dot"/><span>AO VIVO</span></div>
      </div>
    </div>
  );
});

// ── Agenda do canal (reutilizável) ───────────────────────
function ChannelSchedule({ channel, epgSchedule, epgLoading }: {
  channel: Channel;
  epgSchedule: Record<string, EpgProgram[]>;
  epgLoading: Record<string, boolean>;
}) {
  const now = Date.now();
  const hm  = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const schedule = [...(epgSchedule[channel.id] || [])].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const isLoading = epgLoading[channel.id] ?? false;

  if (isLoading && schedule.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 0', gap: 8 }}>
        <Loader size={14} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite' }}/>
        <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>Carregando programação...</span>
      </div>
    );
  }

  if (!isLoading && schedule.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 0', gap: 6 }}>
        <Clock size={22} color="var(--fg-4)"/>
        <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>Sem programação disponível</span>
      </div>
    );
  }

  return (
    <>
      {schedule.map((prog) => {
        const startMs = new Date(prog.startTime).getTime();
        const endMs   = new Date(prog.endTime).getTime();
        const isCurr  = prog.isNow || (startMs <= now && endMs > now);
        const isPast  = endMs < now;
        const dur     = Math.round((endMs - startMs) / 60_000);
        const durLabel = dur < 60 ? `${dur} min` : `${Math.floor(dur / 60)}h${dur % 60 ? ` ${dur % 60}min` : ''}`;

        return (
          <div key={prog.id} style={{
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: isCurr ? 'rgba(245,158,11,0.07)' : 'transparent',
            borderLeft: isCurr ? '2px solid var(--amber-500)' : '2px solid transparent',
            opacity: isPast ? 0.38 : 1,
          }}>
            {/* Time row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: isCurr ? 'var(--amber-500)' : 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                {hm(prog.startTime)}
              </span>
              {isCurr && (
                <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--live)', padding: '1px 6px', borderRadius: 999, letterSpacing: '0.06em' }}>
                  AGORA
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-4)' }}>{durLabel}</span>
            </div>

            {/* Title */}
            <div style={{ fontSize: 13, fontWeight: isCurr ? 700 : 500, color: isCurr ? 'var(--fg-1)' : 'var(--fg-2)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {prog.title}
            </div>

            {/* Description (current only) */}
            {isCurr && prog.description && (
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {prog.description}
              </div>
            )}

            {/* Progress bar (current only) */}
            {isCurr && typeof prog.progress === 'number' && (
              <div style={{ marginTop: 7, height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                <div style={{ height: '100%', width: `${prog.progress}%`, background: 'var(--amber-500)', borderRadius: 2 }}/>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Inline player (Live TV) ───────────────────────────────
const InlinePlayer = memo(function InlinePlayer() {
  const { currentChannel, setPlayerOpen, playerOpen } = useStore();
  const videoRef  = useRef<HTMLVideoElement>(null);
  const loaderRef = useRef<StreamLoader | null>(null);
  const [buf, setBuf]         = useState(true);
  const [started, setStarted] = useState(false); // true after first successful play
  const [statusMsg, setMsg]   = useState('Conectando...');
  const [error, setError]     = useState('');
  const [hov, setHov]         = useState(false);
  const [vol, setVol]         = useState(1);
  const [muted, setMuted]     = useState(false);

  useEffect(() => {
    const v = videoRef.current; if (!v || !currentChannel) return;
    if (playerOpen) { loaderRef.current?.abort(); return; }

    const url = (currentChannel.streamUrlM3u8 || currentChannel.streamUrl || '').trim();
    if (!url) {
      setBuf(false);
      setError('URL do canal não disponível.');
      return;
    }

    setBuf(true); setError(''); setMsg('Conectando...'); setStarted(false);
    if (!loaderRef.current) loaderRef.current = new StreamLoader(v);
    loaderRef.current.load(
      url,
      () => { setBuf(false); setError(''); setStarted(true); },
      (msg, fatal) => { if (fatal) { setBuf(false); setError(msg); } else { setBuf(true); setMsg(msg); } },
      (buffering) => { setBuf(buffering); },
    );

    const onWaiting = () => { setBuf(true); setMsg('Carregando...'); };
    const onPlaying = () => { setBuf(false); setError(''); setStarted(true); };
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    return () => {
      loaderRef.current?.abort();
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannel?.id, playerOpen]);

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const h = () => { setVol(v.volume); setMuted(v.muted); };
    v.addEventListener('volumechange', h);
    return () => v.removeEventListener('volumechange', h);
  }, []);

  // Media key (Play/Pause) from TV remote
  useEffect(() => {
    const onMedia = () => {
      const v = videoRef.current; if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    };
    document.addEventListener('tv:media', onMedia);
    return () => document.removeEventListener('tv:media', onMedia);
  }, []);

  if (!currentChannel) {
    return (
      <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-0)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: 'var(--inner-card)' }}>
        <MonitorPlay size={40} color="var(--fg-4)"/>
        <p style={{ color: 'var(--fg-3)', fontSize: 13 }}>Selecione um canal para começar.</p>
      </div>
    );
  }

  return (
    <div className="lk-player" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} playsInline autoPlay/>

      {/* Initial loading overlay — only before playback starts */}
      {buf && !error && !started && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', border: '2.5px solid rgba(255,176,46,0.2)', borderTopColor: 'var(--amber-500)', animation: 'spin 0.75s linear infinite', marginBottom: 10 }}/>
          <p style={{ color: 'var(--fg-1)', fontSize: 13, fontWeight: 600 }}>{currentChannel.name}</p>
          <p style={{ color: 'var(--fg-3)', fontSize: 12, marginTop: 4 }}>{statusMsg}</p>
        </div>
      )}

      {/* Rebuffering indicator — non-intrusive corner spinner while video frame stays visible */}
      {buf && !error && started && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: '50%', border: '2.5px solid rgba(255,176,46,0.25)', borderTopColor: 'var(--amber-500)', animation: 'spin 0.75s linear infinite', pointerEvents: 'none' }}/>
      )}

      {/* Error overlay */}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.88)', gap: 12 }}>
          <AlertCircle size={36} color="var(--danger)"/>
          <p style={{ color: 'var(--fg-1)', fontSize: 13, fontWeight: 600 }}>{currentChannel.name}</p>
          <p style={{ color: 'var(--fg-3)', fontSize: 12, maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>{error}</p>
          <button
            className="lk-btn lk-btn--secondary lk-btn--sm"
            onClick={() => {
              const v = videoRef.current; if (!v) return;
              const url = (currentChannel.streamUrlM3u8 || currentChannel.streamUrl || '').trim();
              if (!url) { setError('URL do canal não disponível.'); return; }
              setError(''); setBuf(true); setMsg('Reconectando...');
              if (!loaderRef.current) loaderRef.current = new StreamLoader(v);
              loaderRef.current.load(url,
                () => { setBuf(false); setError(''); },
                (msg, fatal) => { if (fatal) { setBuf(false); setError(msg); } },
                (b) => setBuf(b),
              );
            }}
          >
            <Play size={12}/> Tentar novamente
          </button>
        </div>
      )}

      {/* Top chrome */}
      <div className="top-chrome" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(180deg,rgba(0,0,0,0.65),transparent)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {currentChannel.logo && (
            <div style={{ width: 36, height: 36, borderRadius: 7, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <LogoImg src={currentChannel.logo} name={currentChannel.name}/>
            </div>
          )}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{currentChannel.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{currentChannel.groupTitle}</div>
          </div>
        </div>
        <div className="lk-player live-badge-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--live)', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>
          <span className="lk-live-dot" style={{ background: '#fff', boxShadow: 'none' }}/>AO VIVO
        </div>
      </div>

      {/* Bottom chrome — always in DOM, visibility via opacity for TV remote access */}
      <div
        className="player-controls"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '32px 18px 14px',
          background: 'linear-gradient(to top,rgba(0,0,0,0.85),transparent)',
          backdropFilter: 'blur(4px)',
          opacity: hov ? 1 : 0,
          pointerEvents: hov ? 'auto' : 'none',
          transition: 'opacity 200ms',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            tabIndex={hov ? 0 : -1}
            onClick={() => { if (videoRef.current) videoRef.current.muted = !muted; }}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', display: 'flex', alignItems: 'center', fontSize: 16 }}
            aria-label={muted || vol === 0 ? 'Ativar som' : 'Silenciar'}
          >
            {muted || vol === 0 ? '🔇' : '🔊'}
          </button>
          <input
            type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol}
            tabIndex={hov ? 0 : -1}
            onChange={e => { if (videoRef.current) { videoRef.current.volume = Number(e.target.value); videoRef.current.muted = false; }}}
            style={{ width: 72, accentColor: 'var(--amber-500)', cursor: 'pointer' }}
            aria-label="Volume"
          />
          <div style={{ flex: 1 }}/>
          <button
            tabIndex={hov ? 0 : -1}
            onClick={() => { setPlayerOpen(true); }}
            className="lk-btn lk-btn--primary lk-btn--sm"
          >
            <Maximize size={13}/> Tela cheia
          </button>
        </div>
      </div>
    </div>
  );
});

// ── Expiry helpers ────────────────────────────────────────
async function fetchXtreamInfo(server: string, user: string, pass: string) {
  const base = server.replace(/\/$/, '');
  const res = await fetch(
    `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`Servidor retornou ${res.status}`);
  return await res.json() as { user_info?: { exp_date?: string | null } };
}

function expiresIso(expDate: string | null | undefined): string | undefined {
  if (!expDate) return undefined;
  const ts = parseInt(expDate, 10);
  if (!isNaN(ts) && ts > 0) return new Date(ts * 1000).toISOString();
  return undefined;
}

function expiryColor(expiresAt?: string): string {
  if (!expiresAt) return 'var(--fg-4)';
  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return '#ef4444';
  if (days < 7) return '#f97316';
  if (days < 30) return '#eab308';
  return '#22c55e';
}

function expiryLabel(expiresAt?: string): string {
  if (!expiresAt) return '';
  const days = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Expirada';
  if (days === 0) return 'Expira hoje';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

// ── Modal adicionar lista ─────────────────────────────────
function AddListModal({ onClose }: { onClose: () => void }) {
  const { playlists, addPlaylist, removePlaylist, login, isAuthenticated, token, setLiveChannels, setMovieItems, setSeriesItems, setAllChannels, mergeLiveChannels, mergeChannels, loadAllCats: storeLoadAll } = useStore();
  const [tab, setTab]     = useState<'account' | 'xtream' | 'm3u'>(isAuthenticated ? 'xtream' : 'account');
  const [isReg, setReg]   = useState(false);
  const [email, setEmail]       = useState('');
  const [pwd, setPwd]           = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass]   = useState('');
  const [name, setName]     = useState('');
  const [server, setServer] = useState('');
  const [user, setUser]     = useState('');
  const [pass, setPass]     = useState('');
  const [m3uUrl, setM3u]    = useState('');
  const [expiresAt, setExpires] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep]     = useState('');
  const [err, setErr]       = useState('');
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  const handleAccount = async () => {
    setLoading(true); setErr('');
    try {
      if (isReg) {
        setStep('Criando conta...');
        const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: regEmail, password: regPass, deviceType: 'web' }) });
        const d = await res.json(); if (!res.ok) throw new Error(d.message || 'Erro');
        setStep('Entrando...'); await login(regEmail, regPass);
      } else { setStep('Verificando credenciais...'); await login(email, pwd); }
      setTab('xtream');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erro'); }
    setLoading(false); setStep('');
  };

  const handleConnect = async () => {
    setLoading(true); setErr('');
    try {
      if (tab === 'xtream') {
        if (!server || !user || !pass) { setErr('Preencha todos os campos'); setLoading(false); return; }
        let expIso: string | undefined;
        try {
          setStep('Verificando validade...');
          const info = await fetchXtreamInfo(server, user, pass);
          expIso = expiresIso(info.user_info?.exp_date);
        } catch { /* expiration unknown — continue anyway */ }
        const playlistId = `xt_${Date.now()}`;
        const isFirst = playlists.length === 0;
        const { live, movies, series } = await loadXtreamAll(server, user, pass, {
          onProgress: setStep,
          onLiveReady: (liveChs) => { isFirst ? setLiveChannels(liveChs) : mergeLiveChannels(liveChs); },
        });
        isFirst ? setAllChannels(live, movies, series) : mergeChannels(live, movies, series);
        const listName = name || `${user}@${new URL(server.includes('://') ? server : 'http://' + server).hostname}`;
        addPlaylist({ id: playlistId, name: listName, type: 'xtream', serverUrl: server, username: user, password: pass, expiresAt: expIso, channelCount: live.length, lastSync: new Date().toISOString() });
        saveChannelCache(playlistId, live, movies, series);
        setLoading(false);
        onClose();
        if (token) {
          fetch(`${API}/list/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ type: 'xtream', name: listName, serverUrl: server, username: user, password: pass }),
          }).then(r => r.ok ? storeLoadAll() : null).catch(() => {});
        }
      } else {
        if (!m3uUrl) { setErr('URL é obrigatória'); setLoading(false); return; }
        setStep('Baixando e processando lista...');
        const playlistId = `m3u_${Date.now()}`;
        const { channels, tvgUrl } = await parseM3UFromUrl(m3uUrl, playlistId);
        const live    = channels.filter(ch => !ch.contentType || ch.contentType === 'live');
        const movies  = channels.filter(ch => ch.contentType === 'movie');
        const series  = channels.filter(ch => ch.contentType === 'series');
        const liveChs = live.length > 0 ? live : channels;
        playlists.length === 0
          ? setAllChannels(liveChs, movies, series)
          : mergeChannels(liveChs, movies, series);
        const expIso = expiresAt ? new Date(expiresAt).toISOString() : undefined;
        const channelCount = liveChs.length;
        addPlaylist({ id: playlistId, name: name || 'Lista M3U', type: 'm3u', m3uUrl, xmltvEpgUrl: tvgUrl, expiresAt: expIso, channelCount, lastSync: new Date().toISOString() });
        saveChannelCache(playlistId, liveChs, movies, series);
        setLoading(false);
        onClose();
        if (token) {
          fetch(`${API}/list/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ type: 'm3u', name: name || 'Lista M3U', m3uUrl }),
          }).then(r => r.ok ? storeLoadAll() : null).catch(() => {});
        }
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erro ao conectar'); setLoading(false); setStep(''); }
  };

  const TABS = [
    ...(!isAuthenticated ? [{ id: 'account', label: isReg ? 'Cadastro' : 'Entrar' }] : []),
    { id: 'xtream', label: 'Xtream Codes' },
    { id: 'm3u', label: 'Lista M3U' },
  ];

  // Focus first focusable element when modal opens, and trap Tab within it
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    // Auto-focus first focusable element
    const first = el.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]');
    first?.focus();
    // Trap Tab key within modal
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex="0"]')).filter(f => {
        const s = window.getComputedStyle(f);
        return s.display !== 'none' && s.visibility !== 'hidden';
      });
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
    };
    el.addEventListener('keydown', trapTab);
    return () => el.removeEventListener('keydown', trapTab);
  }, []);

  return (
    <div className="lk-modal-scrim" onClick={e => e.target === e.currentTarget && !loading && onClose()}>
      <div ref={modalRef} className="lk-modal" style={{ maxWidth: 460, width: '100%', padding: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <p style={{ color: 'var(--fg-1)', fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Adicionar lista</p>
            <p style={{ color: 'var(--fg-3)', fontSize: 13 }}>{isAuthenticated ? 'Conecte uma lista Xtream ou M3U' : 'Acesse sua conta ou conecte uma lista'}</p>
          </div>
          {!loading && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', padding: 4, borderRadius: 6 }}><X size={20}/></button>}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, marginBottom: 22, gap: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => !loading && setTab(t.id as typeof tab)}
              style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12, transition: 'all 160ms', background: tab === t.id ? 'var(--amber-500)' : 'transparent', color: tab === t.id ? '#0A0B0F' : 'var(--fg-3)', fontFamily: 'var(--font-sans)' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="E-mail" value={isReg ? regEmail : email} onChange={isReg ? setRegEmail : setEmail} placeholder="seu@email.com" disabled={loading}/>
            <Field label="Senha" value={isReg ? regPass : pwd} onChange={isReg ? setRegPass : setPwd} placeholder="••••••••" type="password" disabled={loading}/>
            {loading && step && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,176,46,0.08)', borderRadius: 8, padding: '10px 14px' }}>
                <Loader size={14} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}/>
                <p style={{ color: 'var(--amber-400)', fontSize: 13 }}>{step}</p>
              </div>
            )}
            {err && <p style={{ color: 'var(--danger)', fontSize: 13, background: 'var(--live-dim)', borderRadius: 8, padding: '10px 14px' }}>{err}</p>}
            <button onClick={handleAccount} disabled={loading}
              className="lk-btn lk-btn--primary" style={{ width: '100%', justifyContent: 'center', borderRadius: 10, padding: '12px', opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? <><Loader size={14} style={{ animation: 'spin 0.7s linear infinite' }}/> {step}</> : isReg ? 'Criar conta' : 'Entrar'}
            </button>
            <p onClick={() => setReg(v => !v)} style={{ color: 'var(--fg-3)', fontSize: 13, textAlign: 'center', cursor: 'pointer' }}>
              {isReg ? 'Já tem conta? Entrar' : 'Não tem conta? Cadastrar'}
            </p>
            <div style={{ borderTop: '1px solid var(--line-1)', paddingTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setTab('xtream')} className="lk-btn lk-btn--ghost lk-btn--sm">Xtream sem conta</button>
              <button onClick={() => setTab('m3u')} className="lk-btn lk-btn--ghost lk-btn--sm">M3U sem conta</button>
            </div>
          </div>
        )}

        {(tab === 'xtream' || tab === 'm3u') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Nome (opcional)" value={name} onChange={setName} placeholder="Minha IPTV" disabled={loading}/>
            {tab === 'xtream' ? <>
              <Field label="URL do servidor *" value={server} onChange={setServer} placeholder="http://servidor:8080" disabled={loading}/>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Usuário *" value={user} onChange={setUser} placeholder="username" disabled={loading}/>
                <Field label="Senha *" value={pass} onChange={setPass} placeholder="password" type="password" disabled={loading}/>
              </div>
            </> : <>
              <Field label="URL da lista M3U *" value={m3uUrl} onChange={setM3u} placeholder="http://servidor/lista.m3u" disabled={loading}/>
              <div>
                <label style={{ color: 'var(--fg-3)', fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>Data de validade (opcional)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={13} color="var(--fg-4)" style={{ flexShrink: 0 }}/>
                  <input type="date" value={expiresAt} onChange={e => setExpires(e.target.value)} disabled={loading}
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, background: 'var(--bg-1)', border: '1px solid var(--line-2)', color: 'var(--fg-1)', fontSize: 14, outline: 'none', fontFamily: 'var(--font-sans)', colorScheme: 'dark' }}/>
                </div>
              </div>
            </>}

            {loading && step && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,176,46,0.08)', borderRadius: 8, padding: '10px 14px' }}>
                <Loader size={14} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}/>
                <p style={{ color: 'var(--amber-400)', fontSize: 13 }}>{step}</p>
              </div>
            )}
            {err && (
              <div style={{ display: 'flex', gap: 8, background: 'var(--live-dim)', borderRadius: 8, padding: '10px 14px' }}>
                <AlertCircle size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }}/>
                <p style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1.5 }}>{err}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => !loading && onClose()} className="lk-btn lk-btn--ghost" style={{ flex: 1, justifyContent: 'center', borderRadius: 10, border: '1px solid var(--line-2)' }}>
                Cancelar
              </button>
              <button onClick={handleConnect} disabled={loading} className="lk-btn lk-btn--primary" style={{ flex: 1, justifyContent: 'center', borderRadius: 10, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? <><Loader size={14} style={{ animation: 'spin 0.7s linear infinite' }}/> Conectando...</> : <><CheckCircle size={14}/> Conectar</>}
              </button>
            </div>
          </div>
        )}

        {playlists.length > 0 && !loading && (
          <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line-1)' }}>
            <p style={{ color: 'var(--fg-4)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>Listas salvas</p>
            {playlists.map(p => {
              const color = expiryColor(p.expiresAt);
              const label = expiryLabel(p.expiresAt);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line-1)', marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,176,46,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber-400)', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{p.type === 'xtream' ? 'X' : 'M'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: 'var(--fg-1)', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>
                        {p.type === 'xtream' ? 'Xtream' : 'M3U'}{p.channelCount ? ` · ${p.channelCount} canais` : ''}
                      </span>
                      {p.expiresAt && (
                        <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}22`, padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>
                          {label}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => { removePlaylist(p.id); clearChannelCache(); }} style={{ background: 'none', border: 'none', color: 'var(--fg-4)', cursor: 'pointer', padding: 4 }}><Trash2 size={14}/></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────
function Sidebar({ activeTab, onTab, onAddList, onSyncPlaylist, syncingId, playlists }: {
  activeTab: string;
  onTab: (tab: string) => void;
  onAddList: () => void;
  onSyncPlaylist: (p: Playlist) => void;
  syncingId: string | null;
  playlists: Playlist[];
}) {
  const navMain = [
    { id: 'live',      label: 'Canais ao Vivo',      Icon: Tv },
    { id: 'guide',     label: 'Guia de Programação', Icon: LayoutGrid },
    { id: 'movies',    label: 'Filmes',               Icon: Film },
    { id: 'series',    label: 'Séries',               Icon: Layers },
  ];
  const navLib = [
    { id: 'favorites', label: 'Favoritos', Icon: Heart },
    { id: 'history',   label: 'Continuar',  Icon: Clock },
  ];

  return (
    <aside className="lk-sidebar">
      {/* Logo */}
      <div className="brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Optmus+ logomark */}
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="optGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFC768"/>
                <stop offset="1" stopColor="#C97C10"/>
              </linearGradient>
            </defs>
            <rect width="34" height="34" rx="9" fill="url(#optGrad)"/>
            {/* O ring — anchored bottom-left area */}
            <circle cx="14" cy="20" r="8.5" fill="none" stroke="white" strokeWidth="3.8"/>
            {/* + cross — top-right corner */}
            <line x1="26" y1="7" x2="26" y2="15" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            <line x1="22" y1="11" x2="30" y2="11" stroke="white" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <span style={{ color: 'var(--fg-1)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em', fontFamily: 'var(--font-sans)' }}>Optmus</span>
            <span style={{ color: 'var(--amber-500)', fontWeight: 900, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1 }}>+</span>
          </div>
        </div>
      </div>

      <nav>
        {navMain.map(({ id, label, Icon }) => (
          <button key={id} className={'nav-item' + (activeTab === id ? ' active' : '')} onClick={() => onTab(id)}>
            <Icon size={16}/> {label}
          </button>
        ))}

        <div className="nav-section">Biblioteca</div>
        {navLib.map(({ id, label, Icon }) => (
          <button key={id} className={'nav-item' + (activeTab === id ? ' active' : '')} onClick={() => onTab(id)}>
            <Icon size={16}/> {label}
          </button>
        ))}

        {playlists.length > 0 && (
          <>
            <div className="nav-section">Minhas Listas</div>
            {playlists.map(p => {
              const color = expiryColor(p.expiresAt);
              const label = expiryLabel(p.expiresAt);
              const syncing = syncingId === p.id;
              return (
                <button key={p.id} className="nav-item" onClick={() => !syncing && onSyncPlaylist(p)}
                  title={syncing ? 'Sincronizando...' : 'Clique para recarregar'}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, height: 'auto', paddingTop: 8, paddingBottom: 8, opacity: syncing ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(255,176,46,0.15)', color: 'var(--amber-400)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                      {p.type === 'xtream' ? 'XT' : 'M3'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--fg-2)' }}>
                      {p.name}
                    </span>
                    {syncing
                      ? <Loader size={12} color="var(--amber-400)" style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}/>
                      : <RefreshCw size={11} color="var(--fg-4)" style={{ flexShrink: 0, opacity: 0.6 }}/>
                    }
                  </div>
                  {p.expiresAt && (
                    <span style={{ fontSize: 10, color, marginLeft: 30 }}>{label}</span>
                  )}
                </button>
              );
            })}
          </>
        )}

        <div className="nav-section">Sistema</div>
        <button className="nav-item" onClick={onAddList}><Plus size={16}/> Adicionar lista</button>
        <a className={activeTab === 'settings' ? 'active' : ''} href="/settings"><Settings size={16}/> Configurações</a>
      </nav>

      {/* Active playlist footer */}
      <div className="user-footer">
        {playlists.length > 0 ? (
          <>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,176,46,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--amber-400)', letterSpacing: '0.05em' }}>
                {playlists[0].type === 'xtream' ? 'XT' : 'M3'}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {playlists[0].name}
              </div>
              {playlists[0].expiresAt ? (
                <div style={{ fontSize: 11, color: expiryColor(playlists[0].expiresAt) }}>
                  {expiryLabel(playlists[0].expiresAt)}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>Ativo</div>
              )}
            </div>
            <button onClick={onAddList} style={{ background: 'none', border: 'none', color: 'var(--fg-4)', cursor: 'pointer', padding: 4, borderRadius: 6 }} title="Gerenciar listas">
              <Settings size={15}/>
            </button>
          </>
        ) : (
          <>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Plus size={16} color="var(--fg-4)"/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>Sem lista</div>
              <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>Adicione uma lista</div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Topbar ───────────────────────────────────────────────
const TAB_LABELS: Record<string, string> = {
  live: 'Canais ao Vivo', guide: 'Guia de Programação', movies: 'Filmes', series: 'Séries',
  favorites: 'Favoritos', history: 'Histórico',
};

function Topbar({ activeTab, onAddList }: {
  activeTab: string;
  onAddList: () => void;
}) {
  return (
    <div className="lk-topbar">
      <span style={{ color: 'var(--fg-1)', fontWeight: 600, fontSize: 16 }}>{TAB_LABELS[activeTab] || ''}</span>
      <div style={{ flex: 1 }}/>
      <button className="lk-icon-btn" title="Notificações"><Bell size={16}/></button>
      <button className="lk-icon-btn" onClick={onAddList} title="Adicionar lista"><Plus size={16}/></button>
    </div>
  );
}

// ── Live TV Screen ────────────────────────────────────────
function LiveTVScreen({ channels, cats, activeCategory, searchQuery, epgNow, epgSchedule, epgLoading, currentChannel, favorites, onPlay, onFav, onCategoryChange, onLoadVisibleEpg, onOpenGuide, catSearch, onCatSearch, loaded, total }: {
  channels: Channel[];
  cats: { name: string; count: number }[];
  activeCategory: string | null;
  searchQuery: string;
  epgNow: Record<string, EpgProgram>;
  epgSchedule: Record<string, EpgProgram[]>;
  epgLoading: Record<string, boolean>;
  currentChannel: Channel | null;
  favorites: string[];
  onPlay: (c: Channel) => void;
  onFav: (id: string) => void;
  onCategoryChange: (cat: string | null) => void;
  onLoadVisibleEpg: (channels: Channel[]) => void;
  onOpenGuide: () => void;
  catSearch: string;
  onCatSearch: (s: string) => void;
  loaded: boolean;
  total: number;
}) {
  // ── Virtual scroll for channel list ──────────────────────────────────────────
  const ITEM_H = 66;   // approx tile height (padding 14 + content ~49) + 3px gap
  const CH_OVERSCAN = 5;
  const listRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [scrollTopCh, setScrollTopCh] = useState(0);
  const [listH, setListH] = useState(700);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setListH(el.clientHeight);
    const ro = new ResizeObserver(() => setListH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Filtro local de canal por nome (campo de busca interno)
  const displayChannels = useMemo(() => {
    if (!catSearch) return channels;
    const q = catSearch.toLowerCase();
    return channels.filter(ch => ch.name.toLowerCase().includes(q));
  }, [channels, catSearch]);

  const chStart = Math.max(0, Math.floor(scrollTopCh / ITEM_H) - CH_OVERSCAN);
  const chEnd   = Math.min(displayChannels.length - 1, Math.ceil((scrollTopCh + listH) / ITEM_H) + CH_OVERSCAN);
  const chPadTop = chStart * ITEM_H;
  const chPadBot = Math.max(0, (displayChannels.length - chEnd - 1) * ITEM_H);

  // Load EPG automatically when the visible channel list changes.
  // Limit to first 50 to avoid flooding the Xtream server with requests.
  const epgTriggerKey = useMemo(
    () => (displayChannels.length > 0 ? displayChannels : channels).slice(0, 40).map(c => c.id).join(','),
    [displayChannels, channels],
  );
  useEffect(() => {
    // Debounce: wait 500 ms after last change before firing EPG requests
    const timer = setTimeout(() => {
      const chs = (displayChannels.length > 0 ? displayChannels : channels).slice(0, 40);
      if (chs.length > 0) onLoadVisibleEpg(chs);
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epgTriggerKey]);

  // Load EPG for the selected channel immediately if not already loaded
  useEffect(() => {
    if (currentChannel && !epgSchedule[currentChannel.id] && !epgLoading[currentChannel.id]) {
      onLoadVisibleEpg([currentChannel]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannel?.id]);

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 13px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--amber-500)' : 'var(--bg-4)',
    color: active ? '#0A0B0F' : 'var(--fg-3)',
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'background 120ms, color 120ms',
  });

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

      {/* ── Painel esquerdo ── */}
      <div style={{
        width: 300,
        flexShrink: 0,
        background: 'var(--bg-2)',
        borderRight: '1px solid var(--line-1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header: título + total */}
        <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>Canais</span>
          <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
            {displayChannels.length}{total > displayChannels.length ? ` de ${total}` : ''} canais
          </span>
        </div>

        {/* Busca de canal */}
        <div style={{ padding: '0 10px 8px', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-4)', pointerEvents: 'none' }}/>
            <input
              type="text"
              placeholder="Buscar canal..."
              value={catSearch}
              onChange={e => onCatSearch(e.target.value)}
              style={{ width: '100%', padding: '6px 8px 6px 26px', borderRadius: 7, background: 'var(--bg-3)', border: '1px solid var(--line-1)', color: 'var(--fg-1)', fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-sans)' }}
            />
          </div>
        </div>

        {/* Chips de categoria — scroll horizontal */}
        <div ref={chipsRef} style={{ overflowX: 'auto', flexShrink: 0, paddingBottom: 8 }} className="scrollbar-hide">
          <div style={{ display: 'flex', gap: 6, padding: '0 10px', minWidth: 'max-content' }}>
            <button onClick={() => onCategoryChange(null)} style={chipStyle(!activeCategory)}>Todos</button>
            {cats.map(cat => (
              <button key={cat.name} onClick={() => onCategoryChange(cat.name)} style={chipStyle(activeCategory === cat.name)}>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--line-1)', flexShrink: 0 }}/>

        {/* Lista de canais — virtual scroll */}
        <div
          ref={listRef}
          style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
          className="scrollbar-hide"
          onScroll={e => setScrollTopCh(e.currentTarget.scrollTop)}
        >
          {!loaded && displayChannels.length === 0 && !catSearch && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: 8 }}>
              <Loader size={15} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite' }}/>
              <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>Carregando...</span>
            </div>
          )}
          {displayChannels.length === 0 && (loaded || catSearch) && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 8 }}>
              <Search size={24} color="var(--fg-4)"/>
              <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>Nenhum canal encontrado</span>
            </div>
          )}
          {displayChannels.length > 0 && (
            <div style={{ padding: '6px 8px 10px' }}>
              {chPadTop > 0 && <div style={{ height: chPadTop }} />}
              {displayChannels.slice(chStart, chEnd + 1).map(ch => (
                <div key={ch.id} style={{ marginBottom: 3 }}>
                  <ChannelTile ch={ch} isActive={currentChannel?.id === ch.id} epgTitle={epgNow[ch.id]?.title} onPlay={onPlay}/>
                </div>
              ))}
              {chPadBot > 0 && <div style={{ height: chPadBot }} />}
            </div>
          )}
        </div>
      </div>

      {/* ── Painel direito: player + agenda ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* Player + info (altura fixa) */}
        <div style={{ flexShrink: 0, padding: '16px 24px 12px', borderBottom: '1px solid var(--line-1)' }}>

          <InlinePlayer/>

          {currentChannel && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                <LogoImg src={currentChannel.logo} name={currentChannel.name}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {currentChannel.groupTitle || 'Canal'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentChannel.name}
                </div>
                {epgNow[currentChannel.id]?.title && (
                  <div style={{ fontSize: 11, color: 'var(--amber-500)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {epgNow[currentChannel.id].title}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="lk-live-dot"/>
                  <span style={{ color: 'var(--live)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>AO VIVO</span>
                </div>
                <button className="lk-btn lk-btn--secondary lk-btn--sm" onClick={() => onFav(currentChannel.id)}>
                  <Heart size={12} fill={favorites.includes(currentChannel.id) ? 'var(--amber-500)' : 'none'} color={favorites.includes(currentChannel.id) ? 'var(--amber-500)' : 'currentColor'}/>
                  {favorites.includes(currentChannel.id) ? 'Salvo' : 'Salvar'}
                </button>
                <button className="lk-btn lk-btn--secondary lk-btn--sm" onClick={onOpenGuide} title="Guia de programação">
                  <LayoutGrid size={12}/>
                  Guia
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Agenda do canal selecionado (scrollável, preenche o espaço restante) */}
        {currentChannel ? (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} className="scrollbar-hide">
            <ChannelSchedule
              channel={currentChannel}
              epgSchedule={epgSchedule}
              epgLoading={epgLoading}
            />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Clock size={28} color="var(--fg-4)"/>
            <span style={{ color: 'var(--fg-4)', fontSize: 13 }}>Selecione um canal para ver a programação</span>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Tela do Guia de Programação ────────────────────────────
const GUIDE_PANEL_W = 320; // px — left panel width

function GuideScreen({ channels, epgNow, epgSchedule, epgLoading, currentChannel, favorites, onPlay, onFav, onBack, onLoadVisibleEpg }: {
  channels: Channel[];
  epgNow: Record<string, EpgProgram>;
  epgSchedule: Record<string, EpgProgram[]>;
  epgLoading: Record<string, boolean>;
  currentChannel: Channel | null;
  favorites: string[];
  onPlay: (c: Channel) => void;
  onFav: (id: string) => void;
  onBack: () => void;
  onLoadVisibleEpg: (chs: Channel[]) => void;
}) {
  // Load EPG on mount for first 40 channels
  useEffect(() => {
    const chs = channels.slice(0, 40);
    if (chs.length) onLoadVisibleEpg(chs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load EPG for selected channel when it changes
  useEffect(() => {
    if (currentChannel && !epgSchedule[currentChannel.id] && !epgLoading[currentChannel.id]) {
      onLoadVisibleEpg([currentChannel]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannel?.id]);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#0a0b10' }}>

      {/* ══ Painel esquerdo: player + agenda do canal ══ */}
      <div style={{
        width: GUIDE_PANEL_W, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        background: '#0d0e15',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ flexShrink: 0, padding: '12px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={15}/>
          </button>
          <CalendarDays size={13} color="var(--amber-500)"/>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>Guia</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Player */}
        <div style={{ flexShrink: 0, aspectRatio: '16/9', width: '100%', background: '#000', position: 'relative' }}>
          <InlinePlayer/>
        </div>

        {/* Channel identity */}
        {currentChannel && (
          <div style={{ flexShrink: 0, padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: '#161622', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LogoImg src={currentChannel.logo} name={currentChannel.name} size={3}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentChannel.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {currentChannel.groupTitle || 'Canal'}
              </div>
            </div>
            <button
              onClick={() => onFav(currentChannel.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: favorites.includes(currentChannel.id) ? 'var(--amber-500)' : 'var(--fg-4)', flexShrink: 0 }}
            >
              <Star size={14} fill={favorites.includes(currentChannel.id) ? 'var(--amber-500)' : 'none'}/>
            </button>
          </div>
        )}

        {/* ── Agenda do canal (scrollável) ── */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} className="scrollbar-hide">
          {currentChannel ? (
            <ChannelSchedule
              channel={currentChannel}
              epgSchedule={epgSchedule}
              epgLoading={epgLoading}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, padding: 24 }}>
              <Tv size={32} color="var(--fg-4)"/>
              <p style={{ color: 'var(--fg-4)', fontSize: 12, textAlign: 'center' }}>Selecione um canal no guia para ver a programação</p>
            </div>
          )}
        </div>
      </div>

      {/* ══ Painel direito: grade EPG completa ══ */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {channels.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader size={14} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite' }}/>
            <span style={{ color: 'var(--fg-4)', fontSize: 13 }}>Carregando canais...</span>
          </div>
        ) : (
          <EpgGrid
            channels={channels}
            epgSchedule={epgSchedule}
            epgLoading={epgLoading}
            currentChannel={currentChannel}
            onPlay={onPlay}
            onLoadVisibleEpg={onLoadVisibleEpg}
          />
        )}
      </div>
    </div>
  );
}

// ── Tela vazia (sem conteúdo) ─────────────────────────────
function EmptyState({ onAddList }: { onAddList: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: 48 }}>
      <div style={{ width: 72, height: 72, background: 'rgba(255,176,46,0.08)', border: '1px solid rgba(255,176,46,0.2)', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
        <MonitorPlay size={36} color="var(--amber-500)"/>
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)', marginBottom: 8, letterSpacing: '-0.02em' }}>
        Bem-vindo ao Optmus<span style={{ color: 'var(--amber-500)' }}>+</span>
      </h2>
      <p style={{ color: 'var(--fg-3)', fontSize: 14, maxWidth: 360, lineHeight: 1.65, marginBottom: 28 }}>
        Adicione uma lista Xtream Codes ou M3U para começar a assistir.
      </p>
      <button onClick={onAddList} className="lk-btn lk-btn--primary lk-btn--lg">
        <Plus size={17}/> Adicionar lista
      </button>
    </div>
  );
}

// ── Dashboard principal ───────────────────────────────────
export default function Dashboard() {
  const store = useStore();
  const {
    live, movies, series, epgNow, epgSchedule, epgLoading,
    favorites, history, activeTab, activeCategory, searchQuery, currentChannel,
    playerOpen, miniPlayer, isAuthenticated, user,
    setCurrentChannel, setActiveTab, setActiveCategory, setSearchQuery,
    toggleFavorite, addHistory, setPlayerOpen, setMiniPlayer, playMedia,
    logout, loadAllCats, loadCats, loadItems, loadMore, loadEpgNow, loadVisibleEpg,
  } = store;

  const [showModal, setShowModal]       = useState(false);
  const [mediaDetail, setMediaDetail]   = useState<Channel | null>(null);
  const [catSearch, setCatSearch]       = useState('');
  const [visibleCount, setVisible]      = useState(120);
  const [autoLoading, setAutoLoading]   = useState(false);
  const [autoLoadMsg, setAutoLoadMsg]   = useState('Carregando lista...');
  const [syncingId, setSyncingId]       = useState<string | null>(null);

  const currentContent = activeTab === 'movies' ? movies : activeTab === 'series' ? series : live;

  useEffect(() => {
    if (isAuthenticated) {
      const hasAny = live.catsLoaded || movies.catsLoaded || series.catsLoaded;
      if (!hasAny) loadAllCats().catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    loadEpgNow();
    const t = setInterval(loadEpgNow, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { setVisible(120); }, [activeCategory, searchQuery, activeTab]);

  useEffect(() => {
    if (!isAuthenticated) return;
    // Se já temos itens locais (importados via Xtream/M3U), não sobrescreve com backend
    if (activeTab === 'movies' && !movies.itemsLoaded) {
      if (!movies.catsLoaded) loadCats('movie');
      else loadItems('movie', activeCategory || '');
    }
    if (activeTab === 'series' && !series.itemsLoaded) {
      if (!series.catsLoaded) loadCats('series');
      else loadItems('series', activeCategory || '');
    }
  }, [activeTab, isAuthenticated, movies.catsLoaded, series.catsLoaded, movies.itemsLoaded, series.itemsLoaded]);

  useEffect(() => {
    if (!isAuthenticated || !activeCategory) return;
    // Live TV: filtrado localmente por groupTitle — não chama backend (evita 401 e apaga live.items)
    if (activeTab === 'movies')  loadItems('movie', activeCategory);
    if (activeTab === 'series')  loadItems('series', activeCategory);
  }, [activeCategory]);

  // ── TV remote Back key ────────────────────────────────────
  // Use a ref so the handler always sees current state without re-registering
  const backStateRef = useRef({ showModal, mediaDetail, playerOpen, activeTab });
  backStateRef.current = { showModal, mediaDetail, playerOpen, activeTab };
  useEffect(() => {
    const onBack = () => {
      const s = backStateRef.current;
      if (s.showModal)   { setShowModal(false);     return; }
      if (s.mediaDetail) { setMediaDetail(null);     return; }
      if (s.playerOpen)  { setPlayerOpen(false);     return; }
      if (s.activeTab === 'guide') { setActiveTab('live'); return; }
    };
    document.addEventListener('tv:back', onBack);
    return () => document.removeEventListener('tv:back', onBack);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-reload channels from ALL saved playlists on mount ───
  useEffect(() => {
    const saved = store.playlists;
    if (saved.length === 0 || live.items.length > 0) return;

    const run = async () => {
      // Phase 1: load from IndexedDB cache in parallel (instant — no network)
      const cachedAll = await Promise.all(saved.map(p => loadChannelCache(p.id)));
      const cacheLive: Channel[] = [], cacheMovies: Channel[] = [], cacheSeries: Channel[] = [];
      const needFetch: Playlist[] = [];

      for (let i = 0; i < saved.length; i++) {
        const c = cachedAll[i];
        if (c) {
          cacheLive.push(...c.live);
          cacheMovies.push(...c.movies);
          cacheSeries.push(...c.series);
        } else {
          needFetch.push(saved[i]);
        }
      }

      if (cacheLive.length > 0 || cacheMovies.length > 0) {
        store.setAllChannels(dedup(cacheLive), dedup(cacheMovies), dedup(cacheSeries));
        if (needFetch.length === 0) return;
      }

      // Phase 2: fetch playlists not in cache (parallel)
      setAutoLoading(true);
      const fetchedLive: Channel[] = [], fetchedMovies: Channel[] = [], fetchedSeries: Channel[] = [];

      try {
        await Promise.allSettled(needFetch.map(async (p) => {
          try {
            const { live: lch, movies: mch, series: sch } = await fetchPlaylistContent(
              p,
              (msg) => setAutoLoadMsg(msg),
              // For Xtream: show live channels immediately while movies/series load
              p.type === 'xtream'
                ? (liveChs) => { store.mergeLiveChannels(liveChs); setAutoLoading(false); }
                : undefined,
            );
            fetchedLive.push(...lch);
            fetchedMovies.push(...mch);
            fetchedSeries.push(...sch);
            store.updatePlaylist(p.id, { channelCount: lch.length, lastSync: new Date().toISOString() });
            saveChannelCache(p.id, lch, mch, sch);
          } catch (e) {
            setAutoLoadMsg((e instanceof Error ? e.message : 'Erro') + ' — tente recarregar.');
          }
        }));

        const allLive   = dedup([...cacheLive,   ...fetchedLive]);
        const allMovies = dedup([...cacheMovies, ...fetchedMovies]);
        const allSeries = dedup([...cacheSeries, ...fetchedSeries]);
        store.setAllChannels(allLive, allMovies, allSeries);
      } finally { setAutoLoading(false); }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlay = useCallback((ch: Channel) => {
    addHistory(ch);
    if (ch.contentType === 'series' && ch.id.startsWith('ser_')) {
      // Xtream series catalog item: streamUrl is a JSON info endpoint, not a stream.
      // Must open the modal so the user can pick an episode with a real stream URL.
      setMediaDetail(ch);
    } else if (ch.contentType === 'movie' || ch.contentType === 'series') {
      playMedia(ch);
    } else {
      setCurrentChannel(ch);
    }
  }, [setCurrentChannel, playMedia, addHistory, setMediaDetail]);

  const handleSyncPlaylist = useCallback(async (targetPlaylist: Playlist) => {
    setSyncingId(targetPlaylist.id);
    setAutoLoadMsg('Sincronizando lista...');
    setAutoLoading(true);
    try {
      const allPl = store.playlists;
      const allLive: Channel[] = [], allMovies: Channel[] = [], allSeries: Channel[] = [];

      await Promise.allSettled(allPl.map(async (pl) => {
        let lch: Channel[], mch: Channel[], sch: Channel[];
        if (pl.id === targetPlaylist.id) {
          // Fresh network fetch for the target playlist
          const r = await fetchPlaylistContent(
            pl,
            (msg) => setAutoLoadMsg(msg),
            pl.type === 'xtream'
              ? (liveChs) => { store.mergeLiveChannels(liveChs); setAutoLoading(false); }
              : undefined,
          );
          lch = r.live; mch = r.movies; sch = r.series;
          store.updatePlaylist(pl.id, { channelCount: lch.length, lastSync: new Date().toISOString() });
          saveChannelCache(pl.id, lch, mch, sch);
        } else {
          // Load other playlists from cache (fetch if expired)
          const cached = await loadChannelCache(pl.id);
          if (cached) {
            lch = cached.live; mch = cached.movies; sch = cached.series;
          } else {
            const r = await fetchPlaylistContent(pl);
            lch = r.live; mch = r.movies; sch = r.series;
            saveChannelCache(pl.id, lch, mch, sch);
          }
        }
        allLive.push(...lch);
        allMovies.push(...mch);
        allSeries.push(...sch);
      }));

      store.setAllChannels(dedup(allLive), dedup(allMovies), dedup(allSeries));
      setActiveTab('live');
    } catch (e) {
      setAutoLoadMsg((e instanceof Error ? e.message : 'Erro ao sincronizar') + ' — verifique a conexão.');
      await new Promise(r => setTimeout(r, 3000));
    } finally {
      setAutoLoading(false);
      setSyncingId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const favChs = useMemo(() => live.items.filter(c => favorites.includes(c.id)), [live.items, favorites]);

  // Filtro local para filmes/séries (evita chamar o backend ao mudar categoria)
  const mediaContent = activeTab === 'movies' ? movies : series;
  const mediaItems = useMemo(() => {
    const base = activeTab === 'movies' ? movies.items : series.items;
    let result = !activeCategory ? base : base.filter(ch => ch.groupTitle === activeCategory);
    if (searchQuery && searchQuery.length >= 2) {
      const q = searchQuery.toLowerCase();
      result = result.filter(ch => ch.name.toLowerCase().includes(q));
    }
    return result;
  }, [activeTab, movies.items, series.items, activeCategory, searchQuery]);

  const rawList = useMemo(() => {
    if (activeTab === 'favorites') return favChs;
    if (activeTab === 'history')   return history;
    const items = currentContent.items;
    if (searchQuery && searchQuery.length >= 2) {
      const q = searchQuery.toLowerCase();
      return items.filter(ch => ch.name.toLowerCase().includes(q));
    }
    // Filtro local por categoria para live TV (funciona mesmo sem backend)
    if (activeTab === 'live' && activeCategory) {
      return items.filter(ch => ch.groupTitle === activeCategory);
    }
    return items;
  }, [currentContent, favChs, history, activeTab, searchQuery, activeCategory]);

  const hasContent = live.total > 0 || movies.total > 0 || series.total > 0 || live.items.length > 0;
  const isLive    = activeTab === 'live';
  const isGuide   = activeTab === 'guide';
  const isMedia   = activeTab === 'movies' || activeTab === 'series';
  const isFavHist = activeTab === 'favorites' || activeTab === 'history';

  const handleTab = (tab: string) => {
    setActiveTab(tab as typeof activeTab);
    setActiveCategory(null);
    setSearchQuery('');
    setCatSearch('');
  };

  // Label da seção atual
  const sectionLabel =
    activeTab === 'live'      ? (activeCategory || 'Todos os canais') :
    activeTab === 'movies'    ? (activeCategory || 'Filmes') :
    activeTab === 'series'    ? (activeCategory || 'Séries') :
    activeTab === 'favorites' ? 'Favoritos' : 'Histórico';

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        activeTab={activeTab}
        onTab={handleTab}
        onAddList={() => setShowModal(true)}
        onSyncPlaylist={handleSyncPlaylist}
        syncingId={syncingId}
        playlists={store.playlists}
      />

      <div className="lk-main">
        <Topbar
          activeTab={activeTab}
          onAddList={() => setShowModal(true)}
        />

        {/* Conteúdo principal */}
        {autoLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid rgba(255,176,46,0.2)', borderTopColor: 'var(--amber-500)', animation: 'spin 0.75s linear infinite' }}/>
            <p style={{ color: 'var(--fg-3)', fontSize: 14 }}>{autoLoadMsg}</p>
          </div>
        ) : !hasContent ? (
          <EmptyState onAddList={() => setShowModal(true)}/>
        ) : isGuide ? (
          <GuideScreen
            channels={live.items}
            epgNow={epgNow}
            epgSchedule={epgSchedule}
            epgLoading={epgLoading}
            currentChannel={currentChannel}
            favorites={favorites}
            onPlay={handlePlay}
            onFav={toggleFavorite}
            onBack={() => handleTab('live')}
            onLoadVisibleEpg={loadVisibleEpg}
          />
        ) : isLive ? (
          <LiveTVScreen
            channels={rawList}
            cats={live.cats}
            activeCategory={activeCategory}
            searchQuery={searchQuery}
            epgNow={epgNow}
            epgSchedule={epgSchedule}
            epgLoading={epgLoading}
            currentChannel={currentChannel}
            favorites={favorites}
            onPlay={handlePlay}
            onFav={toggleFavorite}
            onCategoryChange={cat => setActiveCategory(cat)}
            onLoadVisibleEpg={loadVisibleEpg}
            onOpenGuide={() => handleTab('guide')}
            catSearch={catSearch}
            onCatSearch={setCatSearch}
            loaded={live.itemsLoaded}
            total={live.total}
          />
        ) : isMedia ? (
          /* Filmes e Séries — usa MediaGrid existente */
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <MediaGrid
              items={mediaItems}
              cats={mediaContent.cats}
              favorites={favorites}
              currentId={currentChannel?.id}
              total={mediaContent.total}
              itemsTotal={mediaItems.length}
              loaded={mediaContent.itemsLoaded}
              type={activeTab === 'movies' ? 'movie' : 'series'}
              activeCategory={activeCategory}
              searchQuery={searchQuery}
              onPlay={handlePlay}
              onFav={toggleFavorite}
              onDetail={ch => setMediaDetail(ch)}
              onCategoryChange={cat => {
                setActiveCategory(cat);
                // Backend pagination mode: fetch from server
                if (mediaContent.items.length < mediaContent.itemsTotal) {
                  loadItems(activeTab === 'movies' ? 'movie' : 'series', cat || '');
                }
              }}
              onSearchChange={setSearchQuery}
              onLoadMore={() => loadMore(activeTab === 'movies' ? 'movie' : 'series', activeCategory || '')}
            />
          </div>
        ) : (
          /* Favoritos / Histórico */
          <div className="lk-page" style={{ padding: '32px 40px' }}>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: 28, fontWeight: 600, color: 'var(--fg-1)', letterSpacing: '-0.02em', marginBottom: 4 }}>{sectionLabel}</h1>
              <p style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                {rawList.length} {activeTab === 'favorites' ? 'itens favoritos' : 'itens no histórico'}
              </p>
            </div>
            {rawList.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12 }}>
                {activeTab === 'favorites' ? <Heart size={40} color="var(--fg-4)"/> : <Clock size={40} color="var(--fg-4)"/>}
                <p style={{ color: 'var(--fg-3)', fontSize: 14 }}>
                  {activeTab === 'favorites' ? 'Nenhum favorito ainda.' : 'Nenhum histórico ainda.'}
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {rawList.slice(0, visibleCount).map(ch => (
                    <PosterCard key={ch.id} ch={ch} isCurrent={currentChannel?.id === ch.id} isFav={favorites.includes(ch.id)} onPlay={handlePlay} onFav={toggleFavorite}/>
                  ))}
                </div>
                {rawList.length > visibleCount && (
                  <div style={{ textAlign: 'center', marginTop: 24 }}>
                    <button onClick={() => setVisible(v => v + 120)} className="lk-btn lk-btn--secondary">
                      <ChevronDown size={14}/> Ver mais ({rawList.length - visibleCount} restantes)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Overlays */}
      {playerOpen && !miniPlayer && (
        <Suspense fallback={
          <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(108,99,255,0.18)', borderTopColor: '#6c63ff', animation: 'spin 0.75s linear infinite' }}/>
          </div>
        }>
          <FullPlayerComp/>
        </Suspense>
      )}
      {miniPlayer && <MiniPlayer/>}
      {showModal && <AddListModal onClose={() => setShowModal(false)}/>}
      {mediaDetail && (
        <MediaModal
          item={mediaDetail}
          allItems={activeTab === 'movies' ? movies.items : activeTab === 'series' ? series.items : []}
          onClose={() => setMediaDetail(null)}
          onPlay={ch => { handlePlay(ch); setMediaDetail(null); }}
        />
      )}
    </div>
  );
}
