'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader, AlertCircle, CheckCircle, Link2, Calendar } from 'lucide-react';
import { useStore } from '@/store';
import { parseM3UFromUrl, loadXtreamAll } from '@/lib/m3u';

// ── Helpers ───────────────────────────────────────────────────
function proxyIfHttp(url: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  if (url.startsWith('http://') && apiUrl) {
    return `${apiUrl}/api/v1/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function fetchXtreamInfo(server: string, user: string, pass: string) {
  const base = server.replace(/\/$/, '');
  const target = `${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  const res = await fetch(proxyIfHttp(target), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Servidor retornou ${res.status}`);
  return await res.json() as {
    user_info?: { exp_date?: string | null; max_connections?: string; status?: string };
  };
}

function expiresIso(expDate: string | null | undefined): string | undefined {
  if (!expDate) return undefined;
  const ts = parseInt(expDate, 10);
  if (!isNaN(ts) && ts > 0) return new Date(ts * 1000).toISOString();
  return undefined;
}

// ── Sub-components ────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text', disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
        {label}
      </label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled} autoComplete="off"
        style={{
          width: '100%', padding: '11px 14px',
          borderRadius: 10, background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)', color: '#fff',
          fontSize: 14, outline: 'none', boxSizing: 'border-box',
          fontFamily: 'inherit', transition: 'border-color 160ms',
          opacity: disabled ? 0.5 : 1,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#f59e0b'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      />
    </div>
  );
}

function Btn({ children, onClick, disabled }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        width: '100%', padding: '13px 20px', borderRadius: 10, border: 'none',
        fontSize: 14, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: 'inherit', background: '#f59e0b', color: '#0a0b0f',
        opacity: disabled ? 0.5 : 1, transition: 'opacity 150ms, transform 80ms',
      }}
    >
      {children}
    </button>
  );
}

// ── Import panel ──────────────────────────────────────────────
function ImportPanel({ onSuccess }: { onSuccess: () => void }) {
  const { addPlaylist, setLiveChannels, setMovieItems, setSeriesItems } = useStore();
  const [type, setType]     = useState<'xtream' | 'm3u'>('xtream');
  const [name, setName]     = useState('');
  const [server, setServer] = useState('');
  const [user, setUser]     = useState('');
  const [pass, setPass]     = useState('');
  const [m3uUrl, setM3u]    = useState('');
  const [expiresAt, setExpires] = useState('');
  const [loading, setLoading]   = useState(false);
  const [step, setStep]         = useState('');
  const [err, setErr]           = useState('');

  const connect = async () => {
    setLoading(true); setErr(''); setStep('');
    try {
      if (type === 'xtream') {
        if (!server || !user || !pass) { setErr('Preencha servidor, usuário e senha'); setLoading(false); return; }
        let expIso: string | undefined;
        try {
          setStep('Verificando credenciais...');
          const info = await fetchXtreamInfo(server, user, pass);
          expIso = expiresIso(info.user_info?.exp_date);
        } catch { /* expiration unknown — continue */ }
        setStep('Carregando canais...');
        const { live, movies, series } = await loadXtreamAll(server, user, pass, setStep);
        setLiveChannels(live);
        if (movies.length) setMovieItems(movies);
        if (series.length) setSeriesItems(series);
        const listName = name || `${user}@${new URL(server.includes('://') ? server : 'http://' + server).hostname}`;
        addPlaylist({ id: `xt_${Date.now()}`, name: listName, type: 'xtream', serverUrl: server, username: user, password: pass, expiresAt: expIso, channelCount: live.length, lastSync: new Date().toISOString() });
        onSuccess();
      } else {
        if (!m3uUrl) { setErr('URL da lista é obrigatória'); setLoading(false); return; }
        setStep('Baixando lista M3U...');
        const { channels, tvgUrl } = await parseM3UFromUrl(m3uUrl);
        const live    = channels.filter(ch => !ch.contentType || ch.contentType === 'live');
        const movies  = channels.filter(ch => ch.contentType === 'movie');
        const series  = channels.filter(ch => ch.contentType === 'series');
        setLiveChannels(live.length ? live : channels);
        if (movies.length) setMovieItems(movies);
        if (series.length) setSeriesItems(series);
        const expIso = expiresAt ? new Date(expiresAt).toISOString() : undefined;
        addPlaylist({ id: `m3u_${Date.now()}`, name: name || 'Lista M3U', type: 'm3u', m3uUrl, xmltvEpgUrl: tvgUrl, expiresAt: expIso, channelCount: (live.length || channels.length), lastSync: new Date().toISOString() });
        onSuccess();
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erro ao conectar'); }
    setLoading(false); setStep('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Type toggle */}
      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 3, gap: 3 }}>
        {(['xtream', 'm3u'] as const).map(t => (
          <button key={t} onClick={() => { setType(t); setErr(''); }}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: type === t ? '#f59e0b' : 'transparent', color: type === t ? '#0a0b0f' : 'rgba(255,255,255,0.5)', transition: 'all 150ms' }}>
            {t === 'xtream' ? 'Xtream Codes' : 'Lista M3U'}
          </button>
        ))}
      </div>

      <Field label="Nome da lista (opcional)" value={name} onChange={setName} placeholder="Minha IPTV" disabled={loading}/>

      {type === 'xtream' ? (
        <>
          <Field label="URL do servidor *" value={server} onChange={setServer} placeholder="http://servidor:8080" disabled={loading}/>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Usuário *" value={user} onChange={setUser} placeholder="username" disabled={loading}/>
            <Field label="Senha *" value={pass} onChange={setPass} placeholder="password" type="password" disabled={loading}/>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <CheckCircle size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }}/>
            A data de validade é detectada automaticamente pelo servidor Xtream.
          </div>
        </>
      ) : (
        <>
          <Field label="URL da lista M3U *" value={m3uUrl} onChange={setM3u} placeholder="http://servidor/lista.m3u" disabled={loading}/>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
              Data de validade (opcional)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={14} color="rgba(255,255,255,0.3)" style={{ flexShrink: 0 }}/>
              <input type="date" value={expiresAt} onChange={e => setExpires(e.target.value)} disabled={loading}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit', colorScheme: 'dark' }}
              />
            </div>
          </div>
        </>
      )}

      {loading && step && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245,158,11,0.08)', borderRadius: 8, padding: '10px 12px' }}>
          <Loader size={13} color="#f59e0b" style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}/>
          <span style={{ color: '#fbbf24', fontSize: 13 }}>{step}</span>
        </div>
      )}

      {err && (
        <div style={{ display: 'flex', gap: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 12px' }}>
          <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }}/>
          <span style={{ color: '#fca5a5', fontSize: 13 }}>{err}</span>
        </div>
      )}

      <Btn onClick={connect} disabled={loading}>
        {loading
          ? <Loader size={14} style={{ animation: 'spin 0.7s linear infinite' }}/>
          : <Link2 size={14}/>
        }
        {loading ? step || 'Conectando...' : 'Entrar'}
      </Btn>
    </div>
  );
}

// ── Main login page ───────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const { playlists } = useStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (playlists.length > 0) router.replace('/dashboard');
  }, [mounted, playlists.length, router]);

  if (!mounted || playlists.length > 0) {
    return (
      <div style={{ height: '100vh', background: '#0a0b0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(245,158,11,0.2)', borderTopColor: '#f59e0b', animation: 'spin 0.75s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0b0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.25); }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
      `}</style>

      {/* Background glow */}
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.08), transparent)', pointerEvents: 'none' }}/>

      <div style={{ width: '100%', maxWidth: 460, position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <svg width="42" height="42" viewBox="0 0 34 34" fill="none">
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#FFC768"/><stop offset="1" stopColor="#C97C10"/>
                </linearGradient>
              </defs>
              <rect width="34" height="34" rx="9" fill="url(#g)"/>
              <circle cx="14" cy="20" r="8.5" fill="none" stroke="white" strokeWidth="3.8"/>
              <line x1="26" y1="7" x2="26" y2="15" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              <line x1="22" y1="11" x2="30" y2="11" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>
              Optmus<span style={{ color: '#f59e0b' }}>+</span>
            </span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Configure sua lista IPTV para começar</p>
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '28px 32px' }}>
          <ImportPanel onSuccess={() => router.replace('/dashboard')}/>
        </div>
      </div>
    </div>
  );
}
