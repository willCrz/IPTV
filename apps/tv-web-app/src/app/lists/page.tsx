'use client';
import { useRouter } from 'next/navigation';
export default function ListsPage() {
  const router = useRouter();
  return (
    <div style={{ height:'100vh', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <p style={{ color:'#fff', fontSize:22, fontWeight:700, marginBottom:8 }}>Gerenciar Listas</p>
        <p style={{ color:'rgba(255,255,255,0.35)', marginBottom:24 }}>Use o botão + Lista no Dashboard</p>
        <button onClick={() => router.push('/dashboard')} className="tv-btn">← Voltar</button>
      </div>
    </div>
  );
}
