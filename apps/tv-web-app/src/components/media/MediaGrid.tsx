'use client';
import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { Play, Star, Search, X, Info, Plus, ChevronRight } from 'lucide-react';
import { type Channel, useStore } from '@/store';
import type { CatInfo } from '@/store';

interface MediaGridProps {
  items: Channel[];
  cats: CatInfo[];
  favorites: string[];
  currentId?: string;
  total: number;
  itemsTotal: number;
  loaded: boolean;
  type: 'movie' | 'series';
  activeCategory: string | null;
  searchQuery: string;
  onPlay: (ch: Channel) => void;
  onFav: (id: string) => void;
  onDetail: (ch: Channel) => void;
  onCategoryChange: (c: string | null) => void;
  onSearchChange: (q: string) => void;
  onLoadMore: () => void;
}

function baseName(name: string): string {
  return name
    .replace(/\s*[-–|]?\s*(dublado|dub|legendado|leg|sub|nacional|pt\.?br|ptbr)\s*$/i, '')
    .replace(/\s*\((dublado|dub|legendado|leg)\)\s*$/i, '')
    .trim();
}

const PAGE = 120;

function buildPageNums(total: number, current: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  if (current > 4) pages.push('...');
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.push(i);
  if (current < total - 3) pages.push('...');
  pages.push(total);
  return pages;
}

// ── Hero ──────────────────────────────────────────────────────
function HeroSection({ item, onPlay, onDetail, onFav, isFav }: {
  item: Channel;
  onPlay: (c: Channel) => void;
  onDetail: (c: Channel) => void;
  onFav: (id: string) => void;
  isFav: boolean;
}) {
  return (
    <div style={{ position: 'relative', height: 380, flexShrink: 0, overflow: 'hidden', background: '#050508' }}>
      {/* Blurred backdrop */}
      {item.logo && (
        <img src={item.logo} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(28px) brightness(0.25)', transform: 'scale(1.15)', pointerEvents: 'none' }} />
      )}

      {/* Gradient overlays */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(5,5,8,1) 0%, rgba(5,5,8,0.85) 45%, rgba(5,5,8,0.1) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(5,5,8,1) 0%, transparent 55%)', pointerEvents: 'none' }} />

      {/* Left content */}
      <div style={{ position: 'absolute', left: 32, bottom: 28, top: 28, right: '38%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {/* Badges */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {item.year && (
            <span style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5, letterSpacing: '0.04em' }}>
              {item.year}
            </span>
          )}
          {item.rating && (
            <span style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Star size={9} fill="#fbbf24" /> {item.rating}
            </span>
          )}
          {item.groupTitle && (
            <span style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', fontSize: 11, padding: '3px 9px', borderRadius: 5 }}>
              {item.groupTitle}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 38, lineHeight: 1.08, marginBottom: 12, letterSpacing: '-0.02em', textShadow: '0 2px 24px rgba(0,0,0,0.6)' }}>
          {item.name}
        </h1>

        {/* Plot */}
        {item.plot && (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.7, marginBottom: 20, maxWidth: 440, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.plot}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => onPlay(item)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--amber-500)', color: '#0A0B0F', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            <Play size={16} fill="#0A0B0F" /> Assistir agora
          </button>
          <button onClick={() => onFav(item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: isFav ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.1)', color: isFav ? '#fbbf24' : '#fff', borderWidth: '1px', borderStyle: 'solid', borderColor: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-sans)', backdropFilter: 'blur(8px)' }}>
            <Plus size={15} /> {isFav ? 'Na minha lista' : 'Minha lista'}
          </button>
          <button onClick={() => onDetail(item)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.14)', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-sans)', backdropFilter: 'blur(8px)' }}>
            <Info size={15} /> Mais informações
          </button>
        </div>
      </div>

      {/* Right poster */}
      {item.logo && (
        <div style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', height: '82%', aspectRatio: '2/3', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.85)', flexShrink: 0 }}>
          <img src={item.logo} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </div>
  );
}

// ── Rail card (portrait) ───────────────────────────────────────
const RailCard = memo(function RailCard({ ch, isCurrent, isFav, onPlay, onDetail, onFav }: {
  ch: Channel; isCurrent: boolean; isFav: boolean;
  onPlay: (c: Channel) => void;
  onDetail: (c: Channel) => void;
  onFav: (id: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={cardRef}
      tabIndex={0}
      aria-label={ch.name}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onFocus={() => setHov(true)}
      onBlur={e => { if (!cardRef.current?.contains(e.relatedTarget as Node)) setHov(false); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onPlay(ch); }
        else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onDetail(ch); }
      }}
      style={{ position: 'relative', width: 128, flexShrink: 0, cursor: 'pointer', borderRadius: 10, overflow: 'hidden', borderWidth: '1px', borderStyle: 'solid', borderColor: isCurrent ? 'var(--amber-500)' : hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)', transform: hov ? 'scale(1.05)' : 'scale(1)', transition: 'all 0.2s', boxShadow: hov ? '0 14px 44px rgba(0,0,0,0.75)' : 'none', outline: 'none' }}
    >
      <div style={{ aspectRatio: '2/3', background: '#0d0d14', position: 'relative', overflow: 'hidden' }}>
        {ch.logo
          ? <img src={ch.logo} alt={ch.name} style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s', transform: hov ? 'scale(1.07)' : 'scale(1)' }} loading="lazy" />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, opacity: 0.1 }}>{ch.contentType === 'series' ? '📺' : '🎬'}</div>
        }
        {ch.rating && (
          <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.82)', color: '#fbbf24', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Star size={7} fill="#fbbf24" />{ch.rating}
          </div>
        )}
        {hov && (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 50%, transparent 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '8px' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={e => { e.stopPropagation(); onPlay(ch); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: '#fff', color: '#000', border: 'none', borderRadius: 6, padding: '7px 4px', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
                <Play size={10} fill="#000" /> Assistir
              </button>
              <button onClick={e => { e.stopPropagation(); onDetail(ch); }}
                style={{ width: 29, height: 29, background: 'rgba(255,255,255,0.14)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.3)', color: '#fff', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Info size={11} />
              </button>
            </div>
          </div>
        )}
        <button onClick={e => { e.stopPropagation(); onFav(ch.id); }}
          style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.72)', borderWidth: '1px', borderStyle: 'solid', borderColor: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.5)', opacity: hov || isFav ? 1 : 0, transition: 'opacity 0.15s' }}>
          <Star size={10} fill={isFav ? '#fbbf24' : 'none'} />
        </button>
      </div>
      <div style={{ padding: '7px 8px 9px', background: '#1a1a24' }} onClick={() => onDetail(ch)}>
        <p style={{ color: isCurrent ? 'var(--amber-400, #fbbf24)' : '#e8e8f0', fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{ch.name}</p>
        {ch.year && <p style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10, marginTop: 2 }}>{ch.year}</p>}
      </div>
    </div>
  );
});

// ── Horizontal Rail ───────────────────────────────────────────
function Rail({ title, items, currentId, favorites, onPlay, onDetail, onFav, onViewAll }: {
  title: string;
  items: Channel[];
  currentId?: string;
  favorites: string[];
  onPlay: (c: Channel) => void;
  onDetail: (c: Channel) => void;
  onFav: (id: string) => void;
  onViewAll?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px 12px' }}>
        <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>{title}</h3>
        {onViewAll && (
          <button onClick={onViewAll}
            style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--amber-400, #fbbf24)', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            Ver todos <ChevronRight size={13} />
          </button>
        )}
      </div>
      <div ref={ref} className="scrollbar-hide" style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '2px 24px 14px' }}>
        {items.map(ch => (
          <RailCard
            key={ch.id} ch={ch}
            isCurrent={currentId === ch.id}
            isFav={favorites.includes(ch.id)}
            onPlay={onPlay}
            onDetail={onDetail}
            onFav={onFav}
          />
        ))}
      </div>
    </div>
  );
}

// ── Grid poster card ──────────────────────────────────────────
const PosterCard = memo(function PosterCard({ ch, isFav, isCurrent, onPlay, onFav, onDetail }: {
  ch: Channel; isFav: boolean; isCurrent: boolean;
  onPlay: (c: Channel) => void; onFav: (id: string) => void; onDetail: (c: Channel) => void;
}) {
  const [hov, setHov] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={cardRef}
      tabIndex={0}
      aria-label={ch.name}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onFocus={() => setHov(true)}
      onBlur={e => { if (!cardRef.current?.contains(e.relatedTarget as Node)) setHov(false); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onPlay(ch); }
        else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onDetail(ch); }
      }}
      style={{ position: 'relative', cursor: 'pointer', borderRadius: 10, overflow: 'hidden', borderWidth: '1px', borderStyle: 'solid', borderColor: isCurrent ? 'var(--amber-500)' : hov ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)', transform: hov ? 'scale(1.04)' : 'scale(1)', transition: 'all 0.2s ease', boxShadow: hov ? '0 12px 40px rgba(0,0,0,0.7)' : 'none', outline: 'none' }}
    >
      <div style={{ aspectRatio: '2/3', background: '#0d0d14', position: 'relative', overflow: 'hidden' }}>
        {ch.logo ? (
          <img src={ch.logo} alt={ch.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.3s', transform: hov ? 'scale(1.06)' : 'scale(1)' }} loading="lazy" />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ fontSize: 40, opacity: 0.1 }}>{ch.contentType === 'series' ? '📺' : '🎬'}</div>
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, textAlign: 'center', padding: '0 8px', lineHeight: 1.4 }}>{ch.name}</p>
          </div>
        )}
        {ch.rating && (
          <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.82)', color: '#fbbf24', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 3, backdropFilter: 'blur(4px)' }}>
            <Star size={9} fill="#fbbf24" />{ch.rating}
          </div>
        )}
        {hov && (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '12px 10px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={e => { e.stopPropagation(); onPlay(ch); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: '#fff', color: '#000', border: 'none', borderRadius: 8, padding: '8px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                <Play size={13} fill="#000" /> Assistir
              </button>
              <button onClick={e => { e.stopPropagation(); onDetail(ch); }}
                style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.14)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.3)', color: '#fff', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)', flexShrink: 0 }}>
                <Info size={13} />
              </button>
            </div>
          </div>
        )}
        <button onClick={e => { e.stopPropagation(); onFav(ch.id); }}
          style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.72)', borderWidth: '1px', borderStyle: 'solid', borderColor: isFav ? '#fbbf24' : 'rgba(255,255,255,0.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFav ? '#fbbf24' : 'rgba(255,255,255,0.5)', transition: 'all 0.15s', opacity: hov || isFav ? 1 : 0 }}>
          <Star size={12} fill={isFav ? '#fbbf24' : 'none'} />
        </button>
      </div>
      <div style={{ padding: '8px 9px 10px', background: '#1a1a24' }} onClick={() => onDetail(ch)}>
        <p style={{ color: isCurrent ? 'var(--amber-400, #fbbf24)' : '#e8e8f0', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{ch.name}</p>
        <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
          {ch.year && <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10 }}>{ch.year}</span>}
          {ch.groupTitle && <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.groupTitle}</span>}
        </div>
      </div>
    </div>
  );
});

// ── MediaGrid ─────────────────────────────────────────────────
export function MediaGrid({ items, cats, favorites, currentId, total, itemsTotal, loaded, type, activeCategory, searchQuery, onPlay, onFav, onDetail, onCategoryChange, onSearchChange, onLoadMore }: MediaGridProps) {
  const { history } = useStore();
  const label = type === 'movie' ? 'filmes' : 'séries';
  const [page, setPage] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => { setPage(1); }, [activeCategory, searchQuery, items]);

  // Deduplicate: prefer dubbed version
  const displayItems = useMemo(() => {
    const seen = new Map<string, Channel>();
    for (const ch of items) {
      const key = baseName(ch.name).toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, ch);
      } else {
        const isDub = /(dub|dublado|nacional|pt.?br)/i.test(ch.name);
        if (isDub) seen.set(key, ch);
      }
    }
    return [...seen.values()];
  }, [items]);

  const heroItem = displayItems[0] ?? null;
  const trendingItems = useMemo(() => displayItems.slice(0, 18), [displayItems]);
  const historyItems = useMemo(
    () => history.filter(ch => ch.contentType === type).slice(0, 14),
    [history, type]
  );

  const isFiltered = !!activeCategory || (!!searchQuery && searchQuery.length >= 2);
  const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE));
  const visibleItems = useMemo(() => displayItems.slice((page - 1) * PAGE, page * PAGE), [displayItems, page]);

  const scrollToGrid = () => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const gridTitle = activeCategory
    ? activeCategory
    : searchQuery && searchQuery.length >= 2
      ? `Resultados para "${searchQuery}"`
      : 'Todos os títulos';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0a0b0f' }}>

      {/* Hero — only when not filtered */}
      {!isFiltered && heroItem && (
        <HeroSection
          item={heroItem}
          onPlay={onPlay}
          onDetail={onDetail}
          onFav={onFav}
          isFav={favorites.includes(heroItem.id)}
        />
      )}

      {/* ── Category chips + search ── */}
      <div style={{ padding: '12px 24px 10px', flexShrink: 0, background: '#0a0b0f', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Chips scrollable row */}
          <div ref={chipsRef} className="scrollbar-hide" style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
            <button
              onClick={() => onCategoryChange(null)}
              style={{ padding: '6px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, transition: 'all 0.14s', background: !activeCategory ? '#fff' : 'rgba(255,255,255,0.09)', color: !activeCategory ? '#0A0B0F' : 'rgba(255,255,255,0.55)' }}>
              Todos
            </button>
            {cats.map(({ name: cat }) => (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                style={{ padding: '6px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--font-sans)', fontWeight: activeCategory === cat ? 600 : 400, fontSize: 13, transition: 'all 0.14s', background: activeCategory === cat ? '#fff' : 'rgba(255,255,255,0.09)', color: activeCategory === cat ? '#0A0B0F' : 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>
                {cat}
              </button>
            ))}
          </div>

          {/* Search pill */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder={`Buscar ${label}...`}
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              style={{ padding: '7px 30px 7px 32px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, outline: 'none', width: 196, fontFamily: 'var(--font-sans)' }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--amber-500, #fbbf24)'}
              onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
            {searchQuery && (
              <button onClick={() => onSearchChange('')}
                style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>

          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, flexShrink: 0 }}>
            {displayItems.length} {label}
          </span>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="scrollbar-hide" style={{ flex: 1, overflowY: 'auto' }}>

        {/* Loading */}
        {!loaded && items.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid rgba(255,176,46,0.2)', borderTopColor: 'var(--amber-500, #fbbf24)', animation: 'spin 0.75s linear infinite' }} />
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Carregando {label}...</p>
          </div>
        )}

        {/* Rails — only when not filtered */}
        {!isFiltered && displayItems.length > 0 && (
          <div style={{ paddingTop: 28 }}>
            {historyItems.length > 0 && (
              <Rail
                title="Continue assistindo"
                items={historyItems}
                currentId={currentId}
                favorites={favorites}
                onPlay={onPlay}
                onDetail={onDetail}
                onFav={onFav}
              />
            )}
            <Rail
              title="Em alta hoje"
              items={trendingItems}
              currentId={currentId}
              favorites={favorites}
              onPlay={onPlay}
              onDetail={onDetail}
              onFav={onFav}
              onViewAll={scrollToGrid}
            />
          </div>
        )}

        {/* Grid */}
        {displayItems.length === 0 && loaded ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.25)' }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>{searchQuery ? '🔍' : type === 'movie' ? '🎬' : '📺'}</p>
            <p style={{ fontSize: 15 }}>{searchQuery ? `Nenhum resultado para "${searchQuery}"` : `Nenhum ${type === 'movie' ? 'filme' : 'série'} nesta categoria`}</p>
          </div>
        ) : displayItems.length > 0 ? (
          <div ref={gridRef} style={{ padding: '28px 24px 24px' }}>
            {/* Grid header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>{gridTitle}</h3>
              {totalPages > 1 && (
                <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 12 }}>
                  Página {page} de {totalPages}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
              {visibleItems.map(ch => (
                <PosterCard
                  key={ch.id} ch={ch}
                  isFav={favorites.includes(ch.id)}
                  isCurrent={currentId === ch.id}
                  onPlay={onPlay}
                  onFav={onFav}
                  onDetail={onDetail}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 28, paddingBottom: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  disabled={page === 1}
                  style={{ padding: '6px 14px', borderRadius: 8, borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.1)', cursor: page === 1 ? 'default' : 'pointer', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500, opacity: page === 1 ? 0.32 : 1 }}>
                  ← Anterior
                </button>

                {buildPageNums(totalPages, page).map((p, i) =>
                  p === '...'
                    ? <span key={`e${i}`} style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13, padding: '0 4px' }}>…</span>
                    : <button
                        key={p}
                        onClick={() => { setPage(p as number); gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        style={{ width: 34, height: 34, borderRadius: 8, borderWidth: '1px', borderStyle: 'solid', borderColor: p === page ? 'var(--amber-500, #fbbf24)' : 'rgba(255,255,255,0.1)', cursor: 'pointer', background: p === page ? 'var(--amber-500, #fbbf24)' : 'transparent', color: p === page ? '#0A0B0F' : 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: p === page ? 700 : 400 }}>
                        {p}
                      </button>
                )}

                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  disabled={page === totalPages}
                  style={{ padding: '6px 14px', borderRadius: 8, borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.1)', cursor: page === totalPages ? 'default' : 'pointer', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500, opacity: page === totalPages ? 0.32 : 1 }}>
                  Próxima →
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
