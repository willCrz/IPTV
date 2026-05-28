'use client';
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useStore, type Channel, type EpgProgram } from '@/store';
import { StreamLoader } from '@/lib/stream-loader';

const C = {
  bg:'#0a0a0f', surface:'rgba(14,14,20,0.97)', border:'rgba(255,255,255,0.08)',
  accent:'#6c63ff', accentH:'#8b84ff', text:'#ffffff',
  muted:'rgba(255,255,255,0.55)', dim:'rgba(255,255,255,0.25)',
  danger:'#ef4444', success:'#22c55e',
};

const fmt = (d:string) => new Date(d).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const epgPct = (p:EpgProgram) => {
  const now=Date.now(), s=new Date(p.startTime).getTime(), e=new Date(p.endTime).getTime();
  return Math.min(100,Math.max(0,(now-s)/(e-s)*100));
};
const epgDur = (p:EpgProgram) => {
  const m=Math.round((new Date(p.endTime).getTime()-new Date(p.startTime).getTime())/60000);
  return m>=60?`${Math.floor(m/60)}h${m%60>0?` ${m%60}min`:''}` :`${m}min`;
};

// ── SVG Icons ─────────────────────────────────────────────────
const IBack    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>;
const IPlay    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>;
const IPause   = () => <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const IVolOn   = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>;
const IVolOff  = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>;
const IFull    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>;
const IMin     = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>;
const IList    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>;
const IEPG     = () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>;
const IMini    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 11H5v2h14v-2zm2-7H3v2h18V4zM3 20h18v-2H3v2z"/></svg>;
const IStar    = ({on}:{on:boolean}) => <svg viewBox="0 0 24 24" fill={on?"#fbbf24":"none"} stroke={on?"#fbbf24":"currentColor"} strokeWidth="2" width="20" height="20"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>;
const ISearch  = () => <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>;
const ILang    = () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>;
const ICap     = () => <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 8H6v-2h6v2zm8 4H6v-2h14v2zm0-4h-4v-2h4v2z"/></svg>;
const ISkip10B = () => <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="16" textAnchor="middle" fontSize="6" fontWeight="bold" fill="currentColor">10</text></svg>;
const ISkip10F = () => <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"/><text x="12" y="16" textAnchor="middle" fontSize="6" fontWeight="bold" fill="currentColor">10</text></svg>;

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
};

function SidePanel({ open, onClose, title, sub, children, width=420 }:{
  open:boolean; onClose:()=>void; title:string; sub?:string; children:React.ReactNode; width?:number;
}) {
  return (
    <div style={{ position:'absolute', right:0, top:0, bottom:0, width, background:C.surface, backdropFilter:'blur(24px)', borderLeft:`1px solid ${C.border}`, display:'flex', flexDirection:'column', transform:open?'translateX(0)':'translateX(100%)', transition:'transform 0.3s cubic-bezier(0.4,0,0.2,1)', zIndex:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 22px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div><p style={{ color:C.text, fontWeight:700, fontSize:17 }}>{title}</p>{sub&&<p style={{ color:C.dim, fontSize:12, marginTop:3 }}>{sub}</p>}</div>
        <button onClick={onClose} style={{ background:'rgba(255,255,255,0.07)', border:`1px solid ${C.border}`, borderRadius:8, width:30, height:30, color:C.muted, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>×</button>
      </div>
      <div style={{ flex:1, overflowY:'auto' }} className="scrollbar-hide">{children}</div>
    </div>
  );
}

// ── EPG Panel ─────────────────────────────────────────────────
const EpgPanel = memo(function EpgPanel({ channelId, channelName, open, onClose }:{channelId:string; channelName:string; open:boolean; onClose:()=>void}) {
  const { epgSchedule, epgLoading, loadChannelEpg, currentChannel } = useStore();
  const nowRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  // Read directly from the store — epgSchedule is populated by loadVisibleEpg.
  // undefined = not yet fetched; [] = fetched but empty; [...] = has programs.
  const rawProgs  = epgSchedule[channelId];
  const loading   = epgLoading[channelId] ?? false;
  const progs     = rawProgs
    ? [...rawProgs].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    : [];

  // Trigger load when the panel opens and the channel hasn't been fetched yet.
  useEffect(()=>{
    if (!open || !channelId || !currentChannel) return;
    if (rawProgs === undefined && !loading) loadChannelEpg(currentChannel);
  },[open, channelId]);

  // Scroll to the current program whenever the program list becomes available.
  useEffect(()=>{
    if (open && progs.length > 0)
      setTimeout(()=>nowRef.current?.scrollIntoView({behavior:'smooth',block:'center'}),150);
  },[open, progs.length]);

  return (
    <SidePanel open={open} onClose={onClose} title="Guia de Programação" sub={channelName}>
      {(loading && rawProgs === undefined)?<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, gap:12 }}><div style={{ width:32, height:32, borderRadius:'50%', border:`3px solid rgba(108,99,255,0.2)`, borderTopColor:C.accent, animation:'spin 0.75s linear infinite' }}/><p style={{ color:C.dim }}>Carregando...</p></div>
      :progs.length===0?<div style={{ textAlign:'center', padding:'60px 24px', color:C.dim }}><p style={{ fontSize:48, marginBottom:16 }}>📅</p><p style={{ fontSize:16 }}>EPG não disponível</p><p style={{ fontSize:13, marginTop:8, lineHeight:1.7 }}>Este canal não possui guia de programação cadastrado.</p></div>
      :<div>{progs.map((p,i)=>{
        const s=new Date(p.startTime).getTime(), e=new Date(p.endTime).getTime();
        const isNow=s<=now&&e>=now; const isPast=e<now;
        return (
          <div key={p.id||i} ref={isNow?nowRef:undefined}
            style={{ padding:'13px 20px', borderBottom:`1px solid rgba(255,255,255,0.04)`, opacity:isPast?0.38:1, background:isNow?'rgba(108,99,255,0.1)':'transparent', borderLeft:isNow?`3px solid ${C.accent}`:'3px solid transparent' }}>
            <div style={{ display:'flex', gap:14 }}>
              <div style={{ flexShrink:0, width:44, textAlign:'right' }}>
                <p style={{ fontSize:13, fontWeight:700, color:isNow?C.accent:C.muted, fontFamily:'monospace' }}>{fmt(p.startTime)}</p>
                <p style={{ fontSize:10, color:C.dim, marginTop:4 }}>{epgDur(p)}</p>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  {isNow&&<span style={{ width:7, height:7, borderRadius:'50%', background:C.danger, flexShrink:0, animation:'pulse 2s infinite' }}/>}
                  <p style={{ fontSize:14, fontWeight:isNow?700:400, color:isNow?C.text:'rgba(255,255,255,0.8)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</p>
                </div>
                {p.description&&!isPast&&<p style={{ fontSize:12, color:C.dim, lineHeight:1.5, marginBottom:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{p.description}</p>}
                <p style={{ fontSize:11, color:C.dim }}>{fmt(p.startTime)} – {fmt(p.endTime)}</p>
                {isNow&&<><div style={{ marginTop:7, height:3, background:'rgba(255,255,255,0.1)', borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', background:C.accent, borderRadius:2, width:`${epgPct(p)}%` }}/></div><p style={{ fontSize:11, color:'rgba(108,99,255,0.7)', marginTop:4 }}>{Math.round((new Date(p.endTime).getTime()-now)/60000)} min restantes</p></>}
              </div>
            </div>
          </div>
        );
      })}</div>}
    </SidePanel>
  );
});

// ── Channels Panel ────────────────────────────────────────────
const ChannelsPanel = memo(function ChannelsPanel({ open, onClose, onSelect, currentId }:{open:boolean; onClose:()=>void; onSelect:(ch:Channel)=>void; currentId?:string}) {
  const { live, movies, series, activeTab, activeCategory, setActiveCategory, favorites } = useStore();
  const [q, setQ] = useState('');
  const curRef = useRef<HTMLButtonElement>(null);

  // Qual conteúdo mostrar baseado na aba ativa
  const content = activeTab === 'movies' ? movies : activeTab === 'series' ? series : live;
  const allItems = content.items || [];
  const filtered = q
    ? allItems.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
    : (activeCategory
        ? allItems.filter(c=>c.groupTitle===activeCategory)
        : allItems);

  useEffect(()=>{ if (open) setTimeout(()=>curRef.current?.scrollIntoView({behavior:'smooth',block:'center'}),200); },[open]);

  const tabLabel = activeTab==='movies'?'Filmes':activeTab==='series'?'Séries':'Canais';

  return (
    <SidePanel open={open} onClose={onClose} title={tabLabel} sub={`${content.itemsTotal||content.total} disponíveis`} width={450}>
      <div style={{ position:'sticky', top:0, background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'12px 18px', zIndex:5, backdropFilter:'blur(16px)' }}>
        <div style={{ position:'relative', marginBottom:8 }}>
          <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:C.dim }}><ISearch/></span>
          <input type="text" placeholder={`Buscar ${tabLabel.toLowerCase()}...`} value={q} onChange={e=>setQ(e.target.value)}
            style={{ width:'100%', padding:'8px 12px 8px 30px', borderRadius:9, background:'rgba(255,255,255,0.07)', borderWidth:'1px', borderStyle:'solid', borderColor:C.border, color:C.text, fontSize:13, outline:'none', boxSizing:'border-box' }}
            onFocus={e=>e.currentTarget.style.borderColor=C.accent} onBlur={e=>e.currentTarget.style.borderColor=C.border}/>
        </div>
        {!q&&<div style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:2 }} className="scrollbar-hide">
          <button onClick={()=>setActiveCategory(null)} style={{ padding:'4px 11px', borderRadius:14, border:'none', flexShrink:0, cursor:'pointer', fontSize:11, fontWeight:700, background:!activeCategory?C.accent:'rgba(255,255,255,0.07)', color:!activeCategory?'#fff':C.muted }}>Todas</button>
          {(content.cats||[]).map(({name:cat, count})=>(
            <button key={cat} onClick={()=>setActiveCategory(cat)} style={{ padding:'4px 11px', borderRadius:14, border:'none', flexShrink:0, cursor:'pointer', fontSize:11, fontWeight:600, whiteSpace:'nowrap', background:activeCategory===cat?C.accent:'rgba(255,255,255,0.07)', color:activeCategory===cat?'#fff':C.muted }}>
              {cat} ({count})
            </button>
          ))}
        </div>}
      </div>
      <div>
        {filtered.length===0?<p style={{ textAlign:'center', padding:'40px 20px', color:C.dim, fontSize:14 }}>Nenhum item encontrado</p>
        :filtered.map(ch=>{
          const isActive=ch.id===currentId; const isFav=favorites.includes(ch.id);
          return (
            <button key={ch.id} ref={isActive?curRef:undefined} onClick={()=>{ onSelect(ch); onClose(); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:11, padding:'10px 18px', border:'none', borderBottom:`1px solid rgba(255,255,255,0.04)`, background:isActive?'rgba(108,99,255,0.15)':'transparent', borderLeft:isActive?`3px solid ${C.accent}`:'3px solid transparent', cursor:'pointer', textAlign:'left', transition:'background 0.12s' }}
              onMouseEnter={e=>!isActive&&((e.currentTarget as HTMLButtonElement).style.background='rgba(255,255,255,0.04)')}
              onMouseLeave={e=>!isActive&&((e.currentTarget as HTMLButtonElement).style.background='transparent')}>
              <div style={{ width:38, height:38, borderRadius:7, background:'rgba(255,255,255,0.06)', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {ch.logo?<img src={ch.logo} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }} loading="lazy"/>:<span style={{ opacity:0.2, fontSize:16 }}>▶</span>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ color:isActive?C.accentH:'rgba(255,255,255,0.9)', fontSize:13, fontWeight:isActive?700:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ch.name}</p>
                <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:2 }}>
                  <p style={{ color:C.dim, fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ch.groupTitle}</p>
                  {ch.year&&<span style={{ color:C.dim, fontSize:10, flexShrink:0 }}>{ch.year}</span>}
                  {ch.rating&&<span style={{ color:'#fbbf24', fontSize:10, flexShrink:0 }}>★ {ch.rating}</span>}
                </div>
              </div>
              {isFav&&<span style={{ color:'#fbbf24', fontSize:13 }}>★</span>}
              {isActive&&<span style={{ width:7, height:7, borderRadius:'50%', background:C.danger, animation:'pulse 2s infinite' }}/>}
            </button>
          );
        })}
      </div>
    </SidePanel>
  );
});

// ── Language / Subtitle Panel ─────────────────────────────────
const TrackPanel = memo(function TrackPanel({ videoRef, open, onClose }:{videoRef:React.RefObject<HTMLVideoElement>; open:boolean; onClose:()=>void}) {
  const [audioTracks, setAudioTracks] = useState<{ id:string; label:string; language:string; enabled:boolean }[]>([]);
  const [textTracks,  setTextTracks]  = useState<{ id:string; label:string; language:string; mode:string }[]>([]);
  const [hasHls, setHasHls]           = useState(false);

  useEffect(()=>{
    if (!open||!videoRef.current) return;
    const v = videoRef.current;

    // Faixas nativas do video (audioTracks é não-padrão em alguns browsers)
    const vExt = v as HTMLVideoElement & { audioTracks?: ArrayLike<{ label: string; language: string; enabled: boolean }> };
    const aTracks = Array.from(vExt.audioTracks||[]).map((t,i)=>({ id:String(i), label:t.label||`Áudio ${i+1}`, language:t.language||'', enabled:t.enabled }));
    const tTracks = Array.from(v.textTracks||[]).map((t,i)=>({ id:String(i), label:t.label||`Legenda ${i+1}`, language:t.language||'', mode:t.mode }));
    setAudioTracks(aTracks);
    setTextTracks(tTracks);

    // Verificar HLS.js levels
    const hlsInstance = (v as unknown as { _hls?: { audioTracks?: unknown[] } })._hls;
    setHasHls(!!hlsInstance);
  },[open]);

  const setAudio = (id:string) => {
    const v = videoRef.current; if (!v) return;
    Array.from((v as HTMLVideoElement & { audioTracks?: ArrayLike<{ enabled: boolean }> }).audioTracks||[]).forEach((t,i)=>{ t.enabled = String(i)===id; });
    setAudioTracks(t => t.map((tr,i)=>({ ...tr, enabled:String(i)===id })));
  };

  const setSubtitle = (id:string, mode:'showing'|'disabled') => {
    const v = videoRef.current; if (!v) return;
    Array.from(v.textTracks||[]).forEach((t,i)=>{ t.mode = String(i)===id ? mode : 'disabled'; });
    setTextTracks(t => t.map((tr,i)=>({ ...tr, mode:String(i)===id?mode:'disabled' })));
  };

  return (
    <SidePanel open={open} onClose={onClose} title="Idioma e Legendas" width={340}>
      <div style={{ padding:'16px 20px' }}>

        {/* Áudio */}
        <p style={{ color:C.muted, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:12 }}>Faixa de Áudio</p>
        {audioTracks.length===0?(
          <div style={{ padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.04)', border:`1px solid ${C.border}`, marginBottom:20 }}>
            <p style={{ color:C.dim, fontSize:13 }}>Nenhuma faixa disponível</p>
            <p style={{ color:C.dim, fontSize:11, marginTop:4, lineHeight:1.5 }}>O stream atual não expõe múltiplas faixas de áudio. Isso é comum em streams HLS ao vivo.</p>
          </div>
        ):(
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
            {audioTracks.map(t=>(
              <button key={t.id} onClick={()=>setAudio(t.id)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:9, border:`1px solid ${t.enabled?C.accent:C.border}`, background:t.enabled?'rgba(108,99,255,0.1)':'rgba(255,255,255,0.03)', cursor:'pointer', textAlign:'left', transition:'all 0.15s' }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:t.enabled?C.accent:C.dim, flexShrink:0 }}/>
                <div>
                  <p style={{ color:t.enabled?C.accentH:C.text, fontSize:13, fontWeight:t.enabled?600:400 }}>{t.label}</p>
                  {t.language&&<p style={{ color:C.dim, fontSize:11 }}>{t.language}</p>}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Legendas */}
        <p style={{ color:C.muted, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:12 }}>Legendas</p>
        {textTracks.length===0?(
          <div style={{ padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.04)', border:`1px solid ${C.border}` }}>
            <p style={{ color:C.dim, fontSize:13 }}>Nenhuma legenda disponível</p>
            <p style={{ color:C.dim, fontSize:11, marginTop:4, lineHeight:1.5 }}>Este stream não possui faixas de legenda incorporadas.</p>
          </div>
        ):(
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <button onClick={()=>textTracks.forEach((_,i)=>setSubtitle(String(i),'disabled'))}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:9, border:`1px solid ${textTracks.every(t=>t.mode==='disabled')?C.accent:C.border}`, background:textTracks.every(t=>t.mode==='disabled')?'rgba(108,99,255,0.1)':'rgba(255,255,255,0.03)', cursor:'pointer', textAlign:'left' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:textTracks.every(t=>t.mode==='disabled')?C.accent:C.dim, flexShrink:0 }}/>
              <p style={{ color:textTracks.every(t=>t.mode==='disabled')?C.accentH:C.text, fontSize:13 }}>Desativada</p>
            </button>
            {textTracks.map(t=>(
              <button key={t.id} onClick={()=>setSubtitle(t.id,'showing')}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:9, border:`1px solid ${t.mode==='showing'?C.accent:C.border}`, background:t.mode==='showing'?'rgba(108,99,255,0.1)':'rgba(255,255,255,0.03)', cursor:'pointer', textAlign:'left', transition:'all 0.15s' }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:t.mode==='showing'?C.accent:C.dim, flexShrink:0 }}/>
                <div>
                  <p style={{ color:t.mode==='showing'?C.accentH:C.text, fontSize:13, fontWeight:t.mode==='showing'?600:400 }}>{t.label}</p>
                  {t.language&&<p style={{ color:C.dim, fontSize:11 }}>{t.language}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </SidePanel>
  );
});

// ── FullPlayer ────────────────────────────────────────────────
export function FullPlayer() {
  const { currentChannel, epgNow, loadEpgNow, setCurrentChannel,
          setMiniPlayer, setPlayerOpen, closePlayer, addHistory,
          toggleFavorite, favorites, activeTab } = useStore();

  const videoRef  = useRef<HTMLVideoElement>(null);
  const loaderRef = useRef<StreamLoader|null>(null);
  const hideRef   = useRef<ReturnType<typeof setTimeout>|null>(null);

  const [buf,         setBuf]     = useState(true);
  const [err,         setErr]     = useState('');
  const [fatal,       setFatal]   = useState(false);
  const [playing,     setPlaying] = useState(false);
  const [vol,         setVol]     = useState(1);
  const [muted,       setMuted]   = useState(false);
  const [showUI,      setShowUI]  = useState(true);
  const [showEPG,     setShowEPG] = useState(false);
  const [showChs,     setShowChs] = useState(false);
  const [showTrack,   setTrack]   = useState(false);
  const [loadMs,      setLoadMs]  = useState(0);
  const [full,        setFull]    = useState(false);
  const [clock,       setClock]   = useState('');
  const [currentTime, setCurTime] = useState(0);
  const [duration,    setDuration]= useState(0);
  const loadStart = useRef(0);

  const epgNow_ = currentChannel ? epgNow[currentChannel.id] : null;
  const isFav   = currentChannel ? favorites.includes(currentChannel.id) : false;
  const isLive  = currentChannel?.contentType === 'live' || !currentChannel?.contentType;

  useEffect(()=>{
    const t=()=>setClock(new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));
    t(); const i=setInterval(t,10000); return ()=>clearInterval(i);
  },[]);

  const resetHide = useCallback(()=>{
    setShowUI(true);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(()=>{ setShowUI(false); }, 4000);
  },[]);

  useEffect(()=>{
    const v=videoRef.current; if (!v||!currentChannel) return;
    setBuf(true); setErr(''); setFatal(false); setPlaying(false); setCurTime(0); setDuration(0);
    loadStart.current=Date.now();
    const url=currentChannel.streamUrlM3u8||currentChannel.streamUrl;
    if (!loaderRef.current) loaderRef.current=new StreamLoader(v);
    loaderRef.current.load(url,
      ()=>{ setBuf(false); setPlaying(true); setLoadMs(Date.now()-loadStart.current); },
      (m,f)=>{ setErr(m); setFatal(f); if (!f) setBuf(true); else setBuf(false); },
      (b)=>setBuf(b)
    );
    resetHide();
    if (isLive) loadEpgNow();
    return ()=>loaderRef.current?.abort();
  },[currentChannel?.id]);

  useEffect(()=>()=>{ loaderRef.current?.abort(); if (hideRef.current) clearTimeout(hideRef.current); },[]);

  useEffect(()=>{
    const v=videoRef.current; if (!v) return;
    const h={
      volumechange:()=>{setVol(v.volume);setMuted(v.muted);},
      waiting:()=>setBuf(true),
      playing:()=>{setBuf(false);setPlaying(true);setErr('');},
      pause:()=>setPlaying(false),
      timeupdate:()=>setCurTime(v.currentTime),
      loadedmetadata:()=>{setDuration(isFinite(v.duration)?v.duration:0);setCurTime(v.currentTime);},
      durationchange:()=>setDuration(isFinite(v.duration)?v.duration:0),
    };
    Object.entries(h).forEach(([e,fn])=>v.addEventListener(e,fn));
    return ()=>Object.entries(h).forEach(([e,fn])=>v.removeEventListener(e,fn));
  },[]);

  const toggleFull = useCallback(()=>{
    if (!document.fullscreenElement){ document.documentElement.requestFullscreen(); setFull(true); }
    else { document.exitFullscreen(); setFull(false); }
  },[]);
  useEffect(()=>{
    const h=()=>setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange',h); return ()=>document.removeEventListener('fullscreenchange',h);
  },[]);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key==='Escape')    { showChs?setShowChs(false):showEPG?setShowEPG(false):showTrack?setTrack(false):closePlayer(); }
      if (e.key==='e'||e.key==='E') { setShowEPG(v=>!v); setShowChs(false); setTrack(false); resetHide(); }
      if (e.key==='c'||e.key==='C') { setShowChs(v=>!v); setShowEPG(false); setTrack(false); resetHide(); }
      if (e.key==='l'||e.key==='L') { setTrack(v=>!v); setShowChs(false); setShowEPG(false); resetHide(); }
      if ((e.key==='m'||e.key==='M') && !isLive) { setMiniPlayer(true); setPlayerOpen(false); }
      if (e.key==='f'||e.key==='F') toggleFull();
      if (e.key===' '){ e.preventDefault(); videoRef.current?.paused?videoRef.current.play():videoRef.current?.pause(); }
      if (e.key==='ArrowLeft'&&!isLive){ e.preventDefault(); if(videoRef.current) videoRef.current.currentTime=Math.max(0,videoRef.current.currentTime-10); }
      if (e.key==='ArrowRight'&&!isLive){ e.preventDefault(); if(videoRef.current) videoRef.current.currentTime=Math.min(videoRef.current.duration||0,videoRef.current.currentTime+10); }
    };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[showChs,showEPG,showTrack]);

  if (!currentChannel) return null;

  const S:React.CSSProperties = { transition:'opacity 0.3s, transform 0.3s', opacity:showUI?1:0, pointerEvents:showUI?'auto':'none' };
  const btn:React.CSSProperties = { display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'8px 14px', borderRadius:10, borderWidth:'1px', borderStyle:'solid', borderColor:C.border, background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.8)', cursor:'pointer', fontSize:13, fontWeight:500, transition:'all 0.15s', backdropFilter:'blur(8px)' };
  const iBtn:React.CSSProperties = { width:42, height:42, borderRadius:10, borderWidth:'1px', borderStyle:'solid', borderColor:C.border, background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.8)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s', backdropFilter:'blur(8px)' };

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:200 }} onMouseMove={resetHide} onClick={()=>!showUI&&resetHide()}>
      <video ref={videoRef} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} playsInline autoPlay/>

      {/* Buffering */}
      {buf&&!fatal&&(
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.78)', pointerEvents:'none', gap:18 }}>
          {currentChannel.logo&&<div style={{ width:72, height:72, borderRadius:16, background:'rgba(255,255,255,0.06)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}><img src={currentChannel.logo} alt="" style={{ width:'100%', height:'100%', objectFit:'contain', padding:8 }} loading="eager" decoding="async" onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none';}}/></div>}
          <div style={{ width:48, height:48, borderRadius:'50%', border:`3px solid rgba(108,99,255,0.2)`, borderTopColor:C.accent, animation:'spin 0.75s linear infinite' }}/>
          <div style={{ textAlign:'center' }}>
            <p style={{ color:'#fff', fontWeight:700, fontSize:17 }}>{currentChannel.name}</p>
            {epgNow_&&<p style={{ color:C.muted, fontSize:13, marginTop:4 }}>📡 {epgNow_.title}</p>}
            <p style={{ color:C.dim, fontSize:12, marginTop:8 }}>{err||'Conectando ao stream...'}</p>
          </div>
        </div>
      )}

      {/* Erro */}
      {fatal&&(
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.9)', gap:16 }}>
          <div style={{ fontSize:64 }}>📡</div>
          <p style={{ color:'#f87171', fontWeight:700, fontSize:18 }}>Sinal indisponível</p>
          <p style={{ color:C.muted, fontSize:14, textAlign:'center', maxWidth:340, lineHeight:1.6 }}>{err}</p>
          <div style={{ display:'flex', gap:12 }}>
            <button onClick={()=>{ const url=currentChannel.streamUrlM3u8||currentChannel.streamUrl; setBuf(true);setFatal(false);setErr(''); loaderRef.current?.load(url,()=>{setBuf(false);setPlaying(true);},(m,f)=>{setErr(m);setFatal(f);},(b)=>setBuf(b)); }}
              style={{ ...btn, background:C.accent, border:'none', color:'#fff', fontWeight:700, padding:'12px 28px', fontSize:14 }}>↺ Tentar novamente</button>
            <button onClick={closePlayer} style={{ ...btn, padding:'12px 28px', fontSize:14 }}>← Voltar</button>
          </div>
        </div>
      )}

      {/* TOPO */}
      <div style={{ ...S, transform:showUI?'none':'translateY(-10px)', position:'absolute', top:0, left:0, right:0, background:'linear-gradient(to bottom, rgba(0,0,0,0.92), transparent)', padding:'20px 26px 80px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <button onClick={closePlayer} style={iBtn}><IBack/></button>
          {currentChannel.logo?<div style={{ width:50, height:50, borderRadius:12, background:'rgba(255,255,255,0.06)', overflow:'hidden', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><img src={currentChannel.logo} alt="" style={{ width:'100%', height:'100%', objectFit:'contain', padding:4 }} loading="eager" decoding="async" onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none';}}/></div>:<div style={{ width:50, height:50, borderRadius:12, background:'rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>▶</div>}
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <p style={{ color:'#fff', fontWeight:800, fontSize:22 }}>{currentChannel.name}</p>
              {isLive&&<span style={{ background:C.danger, color:'#fff', fontSize:10, fontWeight:800, padding:'3px 9px', borderRadius:6, display:'flex', alignItems:'center', gap:5 }}><span style={{ width:6, height:6, borderRadius:'50%', background:'#fff', animation:'pulse 2s infinite' }}/>AO VIVO</span>}
              {currentChannel.year&&<span style={{ color:C.dim, fontSize:13 }}>{currentChannel.year}</span>}
              {currentChannel.rating&&<span style={{ color:'#fbbf24', fontSize:13 }}>★ {currentChannel.rating}</span>}
              {loadMs>0&&!buf&&<span style={{ background:'rgba(108,99,255,0.15)', color:C.accentH, fontSize:11, padding:'2px 8px', borderRadius:6 }}>⚡{loadMs}ms</span>}
            </div>
            {epgNow_?<p style={{ color:C.muted, fontSize:13, marginTop:4 }}>📡 {epgNow_.title} · {fmt(epgNow_.startTime)}–{fmt(epgNow_.endTime)}</p>:<p style={{ color:C.dim, fontSize:13, marginTop:4 }}>{currentChannel.groupTitle}{currentChannel.plot&&` · ${currentChannel.plot.substring(0,80)}...`}</p>}
          </div>
          <p style={{ color:'#fff', fontFamily:'monospace', fontSize:28, fontWeight:800, letterSpacing:2 }}>{clock}</p>
          <button onClick={()=>currentChannel&&toggleFavorite(currentChannel.id)} style={{ ...iBtn, color:isFav?'#fbbf24':C.muted }}><IStar on={isFav}/></button>
        </div>
      </div>

      {/* Barra EPG */}
      {epgNow_&&isLive&&(
        <div style={{ position:'absolute', bottom:showUI?148:0, left:0, right:0, height:3, background:'rgba(255,255,255,0.08)', transition:'bottom 0.35s', pointerEvents:'none' }}>
          <div style={{ height:'100%', background:C.accent, width:`${epgPct(epgNow_)}%`, transition:'width 1s' }}/>
        </div>
      )}

      {/* RODAPÉ */}
      <div style={{ ...S, transform:showUI?'none':'translateY(10px)', position:'absolute', bottom:0, left:0, right:0, background:'linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.7) 45%, transparent 100%)', padding:'68px 26px 22px' }}>
        {/* EPG atual */}
        {epgNow_&&isLive&&(
          <div style={{ marginBottom:16, display:'flex', gap:20, alignItems:'flex-end' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <span style={{ background:C.danger, color:'#fff', fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:6, letterSpacing:1 }}>AO VIVO</span>
                <span style={{ color:'#fff', fontWeight:700, fontSize:16, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{epgNow_.title}</span>
              </div>
              {epgNow_.description&&<p style={{ color:C.dim, fontSize:12, marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:700 }}>{epgNow_.description}</p>}
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ color:C.muted, fontSize:12 }}>{fmt(epgNow_.startTime)} – {fmt(epgNow_.endTime)}</span>
                <div style={{ flex:1, maxWidth:220, height:4, background:'rgba(255,255,255,0.1)', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', background:C.accent, borderRadius:2, width:`${epgPct(epgNow_)}%`, transition:'width 1s' }}/>
                </div>
                <span style={{ color:C.dim, fontSize:12 }}>{Math.round(epgPct(epgNow_))}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Seek bar — filmes e séries */}
        {!isLive && duration > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
            <span style={{ color:C.muted, fontSize:12, width:44, textAlign:'right', fontFamily:'monospace', flexShrink:0 }}>{fmtTime(currentTime)}</span>
            <input
              type="range" min={0} max={duration} step={0.5} value={currentTime}
              onChange={e=>{ const t=Number(e.target.value); setCurTime(t); if(videoRef.current) videoRef.current.currentTime=t; }}
              style={{ flex:1, accentColor:C.accent, cursor:'pointer' }}
            />
            <span style={{ color:C.muted, fontSize:12, width:44, fontFamily:'monospace', flexShrink:0 }}>{fmtTime(duration)}</span>
          </div>
        )}

        {/* Controles */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Skip -10s */}
          {!isLive && (
            <button onClick={()=>{ if(videoRef.current) videoRef.current.currentTime=Math.max(0,currentTime-10); }} style={{ ...iBtn, width:38, height:38 }} title="-10s [←]">
              <ISkip10B/>
            </button>
          )}
          {/* Play/Pause */}
          <button onClick={()=>videoRef.current?.paused?videoRef.current.play():videoRef.current?.pause()} style={{ ...iBtn, width:48, height:48, fontSize:24 }}>
            {playing?<IPause/>:<IPlay/>}
          </button>
          {/* Skip +10s */}
          {!isLive && (
            <button onClick={()=>{ if(videoRef.current) videoRef.current.currentTime=Math.min(duration,currentTime+10); }} style={{ ...iBtn, width:38, height:38 }} title="+10s [→]">
              <ISkip10F/>
            </button>
          )}

          {/* Volume */}
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <button
              onClick={()=>{ const nm=!muted; setMuted(nm); if(videoRef.current) videoRef.current.muted=nm; }}
              style={{ ...iBtn, width:36, height:36 }}>
              {muted||vol===0?<IVolOff/>:<IVolOn/>}
            </button>
            {/* Custom volume slider — avoids native range fill inconsistencies */}
            <div
              role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((muted?0:vol)*100)}
              tabIndex={0}
              style={{ width:90, height:20, display:'flex', alignItems:'center', cursor:'pointer', flexShrink:0, outline:'none' }}
              onKeyDown={e=>{
                let v=muted?0:vol;
                if(e.key==='ArrowRight'||e.key==='ArrowUp'){e.preventDefault();v=Math.min(1,v+0.05);}
                else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){e.preventDefault();v=Math.max(0,v-0.05);}
                else return;
                setVol(v);setMuted(false);
                if(videoRef.current){videoRef.current.volume=v;videoRef.current.muted=false;}
              }}
              onMouseDown={e=>{
                e.preventDefault();
                const track=e.currentTarget as HTMLDivElement;
                const getV=(cx:number)=>{const r=track.getBoundingClientRect();return Math.max(0,Math.min(1,(cx-r.left)/r.width));};
                const apply=(cx:number)=>{const v=getV(cx);setVol(v);setMuted(false);if(videoRef.current){videoRef.current.volume=v;videoRef.current.muted=false;}};
                apply(e.clientX);
                const mm=(ev:MouseEvent)=>apply(ev.clientX);
                const mu=()=>{window.removeEventListener('mousemove',mm);window.removeEventListener('mouseup',mu);};
                window.addEventListener('mousemove',mm);window.addEventListener('mouseup',mu);
              }}
            >
              <div style={{position:'relative',width:'100%',height:4,borderRadius:2,background:'rgba(255,255,255,0.2)'}}>
                <div style={{position:'absolute',left:0,top:0,height:'100%',borderRadius:2,background:C.accent,width:`${(muted?0:vol)*100}%`}}/>
                <div style={{position:'absolute',top:'50%',left:`${(muted?0:vol)*100}%`,transform:'translate(-50%,-50%)',width:13,height:13,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 4px rgba(0,0,0,0.6)',pointerEvents:'none'}}/>
              </div>
            </div>
            <span style={{ color:C.dim, fontSize:12, width:32 }}>{Math.round((muted?0:vol)*100)}%</span>
          </div>

          <div style={{ flex:1 }}/>

          {/* Botões direitos */}
          {isLive&&(
            <button onClick={()=>{ setShowEPG(v=>!v); setShowChs(false); setTrack(false); resetHide(); }}
              style={{ ...btn, ...(showEPG?{background:C.accent,borderColor:C.accent,color:'#fff'}:{}) }}>
              <IEPG/> Guia <span style={{ opacity:0.4, fontSize:11 }}>[E]</span>
            </button>
          )}

          <button onClick={()=>{ setShowChs(v=>!v); setShowEPG(false); setTrack(false); resetHide(); }}
            style={{ ...btn, ...(showChs?{background:C.accent,borderColor:C.accent,color:'#fff'}:{}) }}>
            <IList/> {activeTab==='movies'?'Filmes':activeTab==='series'?'Séries':'Canais'} <span style={{ opacity:0.4, fontSize:11 }}>[C]</span>
          </button>

          <button onClick={()=>{ setTrack(v=>!v); setShowChs(false); setShowEPG(false); resetHide(); }}
            style={{ ...btn, ...(showTrack?{background:C.accent,borderColor:C.accent,color:'#fff'}:{}) }}
            title="Idioma e Legendas [L]">
            <ILang/> Idioma <span style={{ opacity:0.4, fontSize:11 }}>[L]</span>
          </button>

          {!isLive && <button onClick={()=>{ setMiniPlayer(true); setPlayerOpen(false); }} style={iBtn} title="Mini player [M]"><IMini/></button>}
          <button onClick={toggleFull} style={iBtn} title="Tela cheia [F]">{full?<IMin/>:<IFull/>}</button>
        </div>

        {/* Atalhos */}
        <div style={{ display:'flex', gap:14, marginTop:11, flexWrap:'wrap' }}>
          {[[' ','Play'],['←→',!isLive?'±10s':''],['E',isLive?'Guia':''],['C','Lista'],['L','Idioma'],['M',!isLive?'Mini':''],['F','Full']].filter(([,l])=>l).map(([k,l])=>(
            <span key={k} style={{ color:C.dim, fontSize:11 }}><span style={{ background:'rgba(255,255,255,0.07)', border:`1px solid ${C.border}`, borderRadius:4, padding:'1px 6px', fontFamily:'monospace', fontSize:10, marginRight:4 }}>{k}</span>{l}</span>
          ))}
        </div>
      </div>

      {/* Painéis */}
      {isLive&&<EpgPanel channelId={currentChannel.id} channelName={currentChannel.name} open={showEPG} onClose={()=>setShowEPG(false)}/>}
      <ChannelsPanel open={showChs} onClose={()=>setShowChs(false)} onSelect={(ch)=>{ setCurrentChannel(ch); addHistory(ch); resetHide(); }} currentId={currentChannel.id}/>
      <TrackPanel videoRef={videoRef} open={showTrack} onClose={()=>setTrack(false)}/>
    </div>
  );
}
