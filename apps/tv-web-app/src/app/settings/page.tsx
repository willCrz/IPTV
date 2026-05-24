'use client';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Tv, Film, Layers, Heart, Clock, Plus, Settings, LogOut,
  LayoutGrid, Trash2, RefreshCw, AlertTriangle, CheckCircle2,
  Loader, ChevronRight, User, Database, Info, Star,
  Wifi, WifiOff, Calendar, Bell,
} from 'lucide-react';
import { useStore, type Playlist } from '@/store';
import { loadXtreamAll, parseM3UFromUrl } from '@/lib/m3u';

// ── Expiry helpers (same as dashboard) ────────────────────────
function expiryColor(expiresAt?: string): string {
  if (!expiresAt) return 'var(--fg-4)';
  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  if (days < 0)  return '#ef4444';
  if (days < 7)  return '#f97316';
  if (days < 30) return '#eab308';
  return '#22c55e';
}

function expiryLabel(expiresAt?: string): string {
  if (!expiresAt) return 'Sem validade';
  const days = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0)  return 'Expirada';
  if (days === 0) return 'Expira hoje';
  if (days === 1) return 'Expira amanhã';
  return `${days} dias restantes`;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Sidebar (mirrors dashboard sidebar) ───────────────────────
function Sidebar({ user, isAuthenticated, onLogout, playlists }: {
  user: { email?: string; username?: string } | null;
  isAuthenticated: boolean;
  onLogout: () => void;
  playlists: Playlist[];
}) {
  const router = useRouter();
  const initials = user?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U';

  const navMain = [
    { id: 'live',   label: 'Canais ao Vivo',      Icon: Tv    },
    { id: 'guide',  label: 'Guia de Programação', Icon: LayoutGrid },
    { id: 'movies', label: 'Filmes',               Icon: Film  },
    { id: 'series', label: 'Séries',               Icon: Layers },
  ];
  const navLib = [
    { id: 'favorites', label: 'Favoritos', Icon: Heart },
    { id: 'history',   label: 'Continuar', Icon: Clock },
  ];

  const goTo = (tab: string) => router.push(`/dashboard?tab=${tab}`);

  return (
    <aside className="lk-sidebar">
      <div className="brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="optGradS" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFC768"/><stop offset="1" stopColor="#C97C10"/>
              </linearGradient>
            </defs>
            <rect width="34" height="34" rx="9" fill="url(#optGradS)"/>
            <circle cx="14" cy="20" r="8.5" fill="none" stroke="white" strokeWidth="3.8"/>
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
          <button key={id} className="nav-item" onClick={() => goTo(id)}>
            <Icon size={16}/> {label}
          </button>
        ))}

        <div className="nav-section">Biblioteca</div>
        {navLib.map(({ id, label, Icon }) => (
          <button key={id} className="nav-item" onClick={() => goTo(id)}>
            <Icon size={16}/> {label}
          </button>
        ))}

        {playlists.length > 0 && (
          <>
            <div className="nav-section">Minhas Listas</div>
            {playlists.map(p => {
              const color = expiryColor(p.expiresAt);
              const label = expiryLabel(p.expiresAt);
              return (
                <button key={p.id} className="nav-item" onClick={() => router.push('/dashboard')}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, height: 'auto', paddingTop: 8, paddingBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(255,176,46,0.15)', color: 'var(--amber-400)', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                      {p.type === 'xtream' ? 'XT' : 'M3'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--fg-2)' }}>{p.name}</span>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.expiresAt ? color : 'var(--fg-4)', flexShrink: 0 }}/>
                  </div>
                  {p.expiresAt && <span style={{ fontSize: 10, color, marginLeft: 30 }}>{label}</span>}
                </button>
              );
            })}
          </>
        )}

        <div className="nav-section">Sistema</div>
        <button className="nav-item" onClick={() => router.push('/dashboard')}><Plus size={16}/> Adicionar lista</button>
        <button className="nav-item active"><Settings size={16}/> Configurações</button>
      </nav>

      <div className="user-footer">
        <div className="lk-avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.username || user?.email?.split('@')[0] || 'Conta'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{isAuthenticated ? 'Conectado' : 'Modo offline'}</div>
        </div>
        {isAuthenticated && (
          <button onClick={onLogout} style={{ background: 'none', border: 'none', color: 'var(--fg-4)', cursor: 'pointer', padding: 4, borderRadius: 6 }} title="Sair">
            <LogOut size={15}/>
          </button>
        )}
      </div>
    </aside>
  );
}

// ── Section wrapper ───────────────────────────────────────────
function Section({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<{ size?: number | string; color?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Icon size={14} color="var(--amber-500)"/>
        <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--fg-4)', margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 14, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// ── Row inside a section ──────────────────────────────────────
function Row({ label, value, sub, danger, onClick, children }: {
  label: string; value?: string; sub?: string;
  danger?: boolean; onClick?: () => void; children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 18px', borderBottom: '1px solid var(--line-1)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 150ms',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div>
        <div style={{ fontSize: 14, color: danger ? '#ef4444' : 'var(--fg-1)', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
        {value && <span style={{ fontSize: 13, color: 'var(--fg-3)' }}>{value}</span>}
        {children}
        {onClick && !children && <ChevronRight size={14} color="var(--fg-4)"/>}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────
function Stat({ label, value, Icon }: { label: string; value: number | string; Icon: React.ComponentType<{ size?: number | string; color?: string }> }) {
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,176,46,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={16} color="var(--amber-500)"/>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)', lineHeight: 1 }}>{value.toLocaleString('pt-BR')}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Playlist card ─────────────────────────────────────────────
function PlaylistCard({ p, onSync, onRemove }: {
  p: Playlist;
  onSync: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [syncing, setSyncing]   = useState(false);
  const [syncMsg, setSyncMsg]   = useState('');
  const [syncOk, setSyncOk]     = useState(false);
  const [syncErr, setSyncErr]   = useState('');
  const store = useStore();

  const handleSync = async () => {
    setSyncing(true); setSyncOk(false); setSyncErr(''); setSyncMsg('Iniciando...');
    try {
      if (p.type === 'xtream' && p.serverUrl && p.username && p.password) {
        const { live, movies, series } = await loadXtreamAll(p.serverUrl, p.username, p.password, setSyncMsg);
        store.setLiveChannels(live);
        if (movies.length > 0) store.setMovieItems(movies);
        if (series.length > 0) store.setSeriesItems(series);
        store.updatePlaylist(p.id, { channelCount: live.length, lastSync: new Date().toISOString() });
        setSyncOk(true);
      } else if (p.type === 'm3u' && p.m3uUrl) {
        setSyncMsg('Baixando lista M3U...');
        const { channels } = await parseM3UFromUrl(p.m3uUrl);
        const live    = channels.filter(c => !c.contentType || c.contentType === 'live');
        const movies  = channels.filter(c => c.contentType === 'movie');
        const series  = channels.filter(c => c.contentType === 'series');
        store.setLiveChannels(live.length > 0 ? live : channels);
        if (movies.length > 0) store.setMovieItems(movies);
        if (series.length > 0) store.setSeriesItems(series);
        store.updatePlaylist(p.id, { channelCount: live.length || channels.length, lastSync: new Date().toISOString() });
        setSyncOk(true);
      }
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : 'Erro ao sincronizar');
    } finally {
      setSyncing(false); setSyncMsg('');
      onSync(p.id);
    }
  };

  const color = expiryColor(p.expiresAt);

  return (
    <div style={{ borderBottom: '1px solid var(--line-1)' }}>
      <div style={{ padding: '16px 18px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,176,46,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber-400)', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
            {p.type === 'xtream' ? 'XT' : 'M3'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-1)', marginBottom: 2 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.type === 'xtream' ? (p.serverUrl || '—') : (p.m3uUrl || '—')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Sincronizar lista"
              style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,176,46,0.1)', border: '1px solid rgba(255,176,46,0.2)', color: 'var(--amber-400)', cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: syncing ? 0.6 : 1 }}
            >
              <RefreshCw size={14} style={{ animation: syncing ? 'spin 0.7s linear infinite' : 'none' }}/>
            </button>
            <button
              onClick={() => onRemove(p.id)}
              disabled={syncing}
              title="Remover lista"
              style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Trash2 size={14}/>
            </button>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {p.channelCount !== undefined && (
            <span style={{ fontSize: 12, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Tv size={11}/> {p.channelCount.toLocaleString('pt-BR')} canais
            </span>
          )}
          {p.lastSync && (
            <span style={{ fontSize: 12, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={11}/> Sync: {fmtDate(p.lastSync)}
            </span>
          )}
          <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color, fontWeight: p.expiresAt ? 600 : undefined }}>
            <Calendar size={11}/> {expiryLabel(p.expiresAt)}
          </span>
        </div>

        {/* Sync feedback */}
        {syncing && syncMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: 'rgba(255,176,46,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <Loader size={12} color="var(--amber-500)" style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}/>
            <span style={{ fontSize: 12, color: 'var(--amber-400)' }}>{syncMsg}</span>
          </div>
        )}
        {syncOk && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <CheckCircle2 size={12} color="#22c55e" style={{ flexShrink: 0 }}/>
            <span style={{ fontSize: 12, color: '#22c55e' }}>Lista sincronizada com sucesso!</span>
          </div>
        )}
        {syncErr && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '8px 12px' }}>
            <AlertTriangle size={12} color="#ef4444" style={{ flexShrink: 0 }}/>
            <span style={{ fontSize: 12, color: '#ef4444' }}>{syncErr}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter();
  const store = useStore();
  const {
    user, isAuthenticated, playlists, removePlaylist, logout,
    live, movies, series, favorites, history,
  } = store;

  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing]         = useState(false);

  const handleLogout = useCallback(() => {
    logout();
    router.push('/dashboard');
  }, [logout, router]);

  const handleClearAll = () => {
    setClearing(true);
    localStorage.clear();
    setTimeout(() => { window.location.href = '/'; }, 600);
  };

  const tmdbConfigured = !!(process.env.NEXT_PUBLIC_TMDB_KEY);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-1)' }}>
      <Sidebar
        user={user}
        isAuthenticated={isAuthenticated}
        onLogout={handleLogout}
        playlists={playlists}
      />

      <div className="lk-main">
        {/* Topbar */}
        <div className="lk-topbar">
          <Settings size={16} color="var(--amber-500)"/>
          <span style={{ color: 'var(--fg-1)', fontWeight: 600, fontSize: 16 }}>Configurações</span>
          <div style={{ flex: 1 }}/>
          <button className="lk-icon-btn" title="Notificações"><Bell size={16}/></button>
        </div>

        {/* Scrollable content */}
        <div className="lk-page scrollbar-hide" style={{ padding: '32px 40px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>

            {/* ── Conta ── */}
            <Section title="Conta" icon={User}>
              <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--line-1)' }}>
                <div className="lk-avatar" style={{ width: 48, height: 48, fontSize: 18, borderRadius: 14, flexShrink: 0 }}>
                  {user?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)' }}>
                    {user?.username || user?.email?.split('@')[0] || 'Visitante'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 2 }}>{user?.email || 'Sem conta vinculada'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: isAuthenticated ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isAuthenticated ? 'rgba(34,197,94,0.3)' : 'var(--line-2)'}` }}>
                  {isAuthenticated
                    ? <><Wifi size={12} color="#22c55e"/><span style={{ fontSize: 12, fontWeight: 600, color: '#22c55e' }}>Conectado</span></>
                    : <><WifiOff size={12} color="var(--fg-4)"/><span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Offline</span></>}
                </div>
              </div>
              {isAuthenticated
                ? <Row label="Sair da conta" sub="Desconecta a conta, mantém suas listas" danger onClick={handleLogout}/>
                : <Row label="Entrar na conta" sub="Vincule uma conta para sincronizar dados" onClick={() => router.push('/login')}/>}
            </Section>

            {/* ── Minhas Listas ── */}
            <Section title={`Minhas Listas  (${playlists.length})`} icon={Database}>
              {playlists.length === 0 ? (
                <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <Database size={32} color="var(--fg-4)"/>
                  <p style={{ color: 'var(--fg-3)', fontSize: 14 }}>Nenhuma lista adicionada.</p>
                  <button onClick={() => router.push('/dashboard')} className="lk-btn lk-btn--primary lk-btn--sm">
                    <Plus size={13}/> Adicionar lista
                  </button>
                </div>
              ) : (
                <>
                  {playlists.map(p => (
                    <PlaylistCard
                      key={p.id}
                      p={p}
                      onSync={() => {}}
                      onRemove={removePlaylist}
                    />
                  ))}
                  <div style={{ padding: '12px 18px' }}>
                    <button onClick={() => router.push('/dashboard')} className="lk-btn lk-btn--ghost lk-btn--sm">
                      <Plus size={13}/> Adicionar outra lista
                    </button>
                  </div>
                </>
              )}
            </Section>

            {/* ── Estatísticas ── */}
            <Section title="Conteúdo" icon={Star}>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                <Stat label="Canais ao vivo" value={live.items.length || live.total} Icon={Tv}/>
                <Stat label="Filmes"         value={movies.items.length || movies.total} Icon={Film}/>
                <Stat label="Séries"         value={series.items.length || series.total} Icon={Layers}/>
                <Stat label="Favoritos"      value={favorites.length} Icon={Heart}/>
                <Stat label="Histórico"      value={history.length}   Icon={Clock}/>
              </div>
            </Section>

            {/* ── Integrações ── */}
            <Section title="Integrações" icon={Wifi}>
              <Row
                label="TMDB — Metadados"
                sub="Sinopses, elenco, trailers e capas para filmes e séries"
                value={tmdbConfigured ? 'Ativo' : 'Não configurado'}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: tmdbConfigured ? '#22c55e' : 'var(--fg-4)', background: tmdbConfigured ? 'rgba(34,197,94,0.1)' : 'var(--bg-4)', borderRadius: 6, padding: '2px 8px' }}>
                  {tmdbConfigured ? '✓ Ativo' : '— Inativo'}
                </span>
              </Row>
              {!tmdbConfigured && (
                <div style={{ padding: '12px 18px', background: 'rgba(255,176,46,0.04)', borderTop: '1px solid var(--line-1)' }}>
                  <p style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                    Configure <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-4)', padding: '1px 5px', borderRadius: 4 }}>NEXT_PUBLIC_TMDB_KEY</code> no arquivo <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg-4)', padding: '1px 5px', borderRadius: 4 }}>.env.local</code> para ativar.
                  </p>
                </div>
              )}
            </Section>

            {/* ── Sobre ── */}
            <Section title="Sobre o Aplicativo" icon={Info}>
              <Row label="Versão"      value="1.0.0"/>
              <Row label="Plataforma"  value={process.env.NEXT_PUBLIC_PLATFORM || 'Web'}/>
              <Row label="Armazenamento" value="localStorage"/>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>
                  Metadados fornecidos por{' '}
                  <span style={{ color: 'rgba(1,180,228,0.9)', fontWeight: 600 }}>TMDB</span>.
                  Este produto usa a API do TMDB mas não é endossado pelo TMDB.
                </span>
              </div>
            </Section>

            {/* ── Zona de Perigo ── */}
            <Section title="Zona de Perigo" icon={AlertTriangle}>
              {!confirmClear ? (
                <Row
                  label="Limpar todos os dados"
                  sub="Remove listas, canais, favoritos e histórico — irreversível"
                  danger
                  onClick={() => setConfirmClear(true)}
                />
              ) : (
                <div style={{ padding: '18px' }}>
                  <p style={{ fontSize: 14, color: '#f87171', fontWeight: 600, marginBottom: 6 }}>
                    Tem certeza? Esta ação não pode ser desfeita.
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 14 }}>
                    Todos os dados locais (listas, canais, favoritos e histórico) serão apagados e o app será reiniciado.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="lk-btn lk-btn--ghost lk-btn--sm"
                      style={{ border: '1px solid var(--line-2)' }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleClearAll}
                      disabled={clearing}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 999, background: '#ef4444', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: clearing ? 'not-allowed' : 'pointer', opacity: clearing ? 0.7 : 1, fontFamily: 'var(--font-sans)' }}
                    >
                      {clearing ? <Loader size={13} style={{ animation: 'spin 0.7s linear infinite' }}/> : <Trash2 size={13}/>}
                      {clearing ? 'Limpando...' : 'Sim, apagar tudo'}
                    </button>
                  </div>
                </div>
              )}
            </Section>

            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--fg-4)', paddingBottom: 24 }}>
              Optmus+ © {new Date().getFullYear()} — Todos os direitos reservados
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
