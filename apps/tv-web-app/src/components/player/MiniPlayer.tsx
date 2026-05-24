'use client';
import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/store';
import { StreamLoader } from '@/lib/stream-loader';

export function MiniPlayer() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const loaderRef = useRef<StreamLoader | null>(null);
  const { currentChannel, setPlayerOpen, setMiniPlayer, closePlayer } = useStore();
  const [buf, setBuf] = useState(true);
  const [hov, setHov] = useState(false);

  useEffect(() => {
    const v = videoRef.current; if (!v || !currentChannel) return;
    const url = currentChannel.streamUrlM3u8 || currentChannel.streamUrl;
    if (!loaderRef.current) loaderRef.current = new StreamLoader(v);
    loaderRef.current.load(url, () => setBuf(false), () => {}, (b) => setBuf(b));
    return () => { loaderRef.current?.abort(); };
  }, [currentChannel?.id]);

  if (!currentChannel) return null;

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ position:'fixed', bottom:20, right:20, width:310, zIndex:50, borderRadius:12, overflow:'hidden', boxShadow:'0 8px 40px rgba(0,0,0,0.85)', border:'1px solid #2a2a38', background:'#000' }}>
      <div style={{ position:'relative', aspectRatio:'16/9' }}>
        <video ref={videoRef} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} playsInline autoPlay muted />
        {buf && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.7)' }}>
            <div style={{ width:32, height:32, borderRadius:'50%', border:'3px solid rgba(108,99,255,0.2)', borderTopColor:'#6c63ff', animation:'spin 0.75s linear infinite' }} />
          </div>
        )}
        {hov && (
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
            <button onClick={() => { setMiniPlayer(false); setPlayerOpen(true); }}
              style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', fontWeight:700, fontSize:13, cursor:'pointer' }}>
              ▶ Abrir player
            </button>
            <button onClick={closePlayer}
              style={{ background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)', border:'1px solid #2a2a38', borderRadius:8, padding:'6px 14px', fontSize:12, cursor:'pointer' }}>
              ✕ Fechar
            </button>
          </div>
        )}
        <div style={{ position:'absolute', top:6, left:6, background:'#ef4444', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4, display:'flex', alignItems:'center', gap:3 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'#fff', animation:'pulse 2s infinite' }} />
          AO VIVO
        </div>
      </div>
      <div style={{ background:'#111118', padding:'9px 12px', borderTop:'1px solid #2a2a38' }}>
        <p style={{ color:'#e8e8f0', fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentChannel.name}</p>
        <p style={{ color:'#4a4a60', fontSize:11, marginTop:2 }}>{currentChannel.groupTitle}</p>
      </div>
    </div>
  );
}
