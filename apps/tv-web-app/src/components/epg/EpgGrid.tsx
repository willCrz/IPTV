'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Channel, EpgProgram } from '@/store';

const CH_COL   = 200;
const CH_H     = 72;
const PX_MIN   = 4;
const SLOT_MIN = 30;
const BEFORE   = 60;
const AFTER    = 180;

function fmtHM(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  channels: Channel[];
  epgSchedule: Record<string, EpgProgram[]>;
  epgLoading: Record<string, boolean>;
  currentChannel?: Channel | null;
  onPlay: (ch: Channel) => void;
}

const ROW_OVERSCAN = 4;

export default function EpgGrid({ channels, epgSchedule, epgLoading, currentChannel, onPlay }: Props) {
  const hdrRef  = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const colRef  = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Virtual scroll state
  const [scrollTopY, setScrollTopY] = useState(0);
  const [viewH, setViewH] = useState(600);

  // Measure body container height
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Visible row range
  const rowStart = Math.max(0, Math.floor(scrollTopY / CH_H) - ROW_OVERSCAN);
  const rowEnd   = Math.min(channels.length - 1, Math.ceil((scrollTopY + viewH) / CH_H) + ROW_OVERSCAN);

  const now      = Date.now();
  const startMs  = now - BEFORE * 60_000;
  const endMs    = now + AFTER  * 60_000;
  const totalMin = BEFORE + AFTER;
  const totalW   = totalMin * PX_MIN;

  const minToX = useCallback((ms: number) =>
    Math.round((ms - startMs) / 60_000 * PX_MIN), [startMs]);

  const nowX = minToX(now);

  useEffect(() => {
    if (!bodyRef.current) return;
    const targetX = Math.max(0, nowX - 160);
    bodyRef.current.scrollLeft = targetX;
    if (hdrRef.current) hdrRef.current.scrollLeft = targetX;
  }, [nowX]);

  const onHdrScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const x = e.currentTarget.scrollLeft;
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollLeft = x;
      syncing.current = false;
    });
  }, []);

  const onBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    setScrollTopY(y);
    if (syncing.current) return;
    syncing.current = true;
    const x = e.currentTarget.scrollLeft;
    requestAnimationFrame(() => {
      if (hdrRef.current) hdrRef.current.scrollLeft = x;
      if (colRef.current)  colRef.current.scrollTop  = y;
      syncing.current = false;
    });
  }, []);

  const onColScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    setScrollTopY(y);
    if (syncing.current) return;
    syncing.current = true;
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = y;
      syncing.current = false;
    });
  }, []);

  // Build 30-min header slots
  const slots: Date[] = [];
  {
    const slotStart = new Date(startMs);
    slotStart.setSeconds(0, 0);
    const rem = slotStart.getMinutes() % SLOT_MIN;
    if (rem) slotStart.setMinutes(slotStart.getMinutes() + (SLOT_MIN - rem));
    for (let d = new Date(slotStart); d.getTime() < endMs; d = new Date(d.getTime() + SLOT_MIN * 60_000)) {
      slots.push(new Date(d));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#0f0f0f' }}>

      {/* ── Header row ── */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #222' }}>
        <div style={{ width: CH_COL, flexShrink: 0, background: '#141414', borderRight: '1px solid #222', height: 36 }} />
        <div
          ref={hdrRef}
          onScroll={onHdrScroll}
          style={{ overflowX: 'auto', overflowY: 'hidden', flex: 1 }}
          className="scrollbar-hide"
        >
          <div style={{ position: 'relative', width: totalW, height: 36, background: '#141414' }}>
            {slots.map(slot => (
              <div key={slot.getTime()} style={{
                position: 'absolute',
                left: minToX(slot.getTime()),
                top: 0, bottom: 0,
                display: 'flex', alignItems: 'center',
                paddingLeft: 8,
                fontSize: 11, color: '#888',
                borderLeft: '1px solid #222',
              }}>
                {fmtHM(slot)}
              </div>
            ))}
            <div style={{ position: 'absolute', left: nowX, top: 0, bottom: 0, width: 2, background: '#f59e0b' }} />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Channel column — virtual scroll */}
        <div
          ref={colRef}
          onScroll={onColScroll}
          style={{
            width: CH_COL, flexShrink: 0,
            overflowY: 'auto', overflowX: 'hidden',
            borderRight: '1px solid #222', background: '#141414',
          }}
          className="scrollbar-hide"
        >
          <div style={{ position: 'relative', height: channels.length * CH_H }}>
            {channels.slice(rowStart, rowEnd + 1).map((ch, i) => {
              const rowIdx = rowStart + i;
              const isActive = currentChannel?.id === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => onPlay(ch)}
                  style={{
                    position: 'absolute', top: rowIdx * CH_H, left: 0, right: 0,
                    display: 'flex', alignItems: 'center', gap: 8,
                    height: CH_H,
                    padding: '0 12px',
                    background: isActive ? 'rgba(245,158,11,0.08)' : 'transparent',
                    border: 'none',
                    borderLeft: isActive ? '2px solid #f59e0b' : '2px solid transparent',
                    cursor: 'pointer',
                    borderBottom: '1px solid #1a1a1a', textAlign: 'left',
                  }}
                >
                  {ch.logo
                    ? <img src={ch.logo} alt="" loading="lazy" decoding="async"
                        style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                    : <div style={{ width: 32, height: 32, borderRadius: 4, background: '#222', flexShrink: 0 }} />
                  }
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    {ch.num !== undefined && (
                      <div style={{ fontSize: 10, color: '#555', lineHeight: 1, marginBottom: 2 }}>{ch.num}</div>
                    )}
                    <div style={{
                      fontSize: 12, color: isActive ? '#fbbf24' : '#e0e0e0', fontWeight: isActive ? 600 : 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {ch.name}
                    </div>
                    {ch.groupTitle && (
                      <div style={{
                        fontSize: 10, color: '#555', marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ch.groupTitle}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Program area */}
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}
          className="scrollbar-hide"
        >
          <div style={{ position: 'relative', width: totalW, minHeight: channels.length * CH_H }}>

            <div style={{
              position: 'absolute', left: nowX, top: 0, bottom: 0,
              width: 2, background: '#f59e0b', zIndex: 10, pointerEvents: 'none',
            }} />

            {slots.map(slot => (
              <div key={slot.getTime()} style={{
                position: 'absolute', left: minToX(slot.getTime()), top: 0, bottom: 0,
                width: 1, background: '#1c1c1c', pointerEvents: 'none',
              }} />
            ))}

            {channels.slice(rowStart, rowEnd + 1).map((ch, i) => {
              const rowIdx = rowStart + i;
              const programs = epgSchedule[ch.id];
              const isLoading = epgLoading[ch.id] ?? false;
              const hasPrograms = programs && programs.length > 0;

              return (
                <div
                  key={ch.id}
                  style={{
                    position: 'absolute',
                    top: rowIdx * CH_H, left: 0, right: 0,
                    height: CH_H,
                    borderBottom: '1px solid #1a1a1a',
                  }}
                >
                  {isLoading && !hasPrograms && (
                    [0, 1, 2].map(i => (
                      <div key={i} style={{
                        position: 'absolute',
                        left: i * Math.round(totalW / 3) + 2,
                        top: 8, height: CH_H - 16,
                        width: Math.round(totalW / 3) - 4,
                        borderRadius: 4,
                        background: '#1e1e1e',
                        animation: 'epg-shimmer 1.5s ease-in-out infinite',
                      }} />
                    ))
                  )}

                  {!isLoading && !hasPrograms && (
                    <div style={{
                      position: 'absolute', left: 12, top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 11, color: '#333', whiteSpace: 'nowrap',
                    }}>
                      {(ch.tvgId || ch.id.startsWith('xt_')) ? 'Sem programa disponível' : 'Sem guia disponível'}
                    </div>
                  )}

                  {hasPrograms && programs.map(prog => {
                    const ps = new Date(prog.startTime).getTime();
                    const pe = new Date(prog.endTime).getTime();
                    if (pe < startMs || ps > endMs) return null;

                    const x  = Math.max(0, minToX(ps));
                    const x2 = Math.min(totalW, minToX(pe));
                    const w  = x2 - x;
                    if (w < 4) return null;

                    const isCurrent = !!prog.isNow;
                    const isPast    = !!prog.isPast;

                    return (
                      <div
                        key={prog.id}
                        title={`${fmtHM(new Date(prog.startTime))} – ${fmtHM(new Date(prog.endTime))}  ${prog.title}`}
                        style={{
                          position: 'absolute',
                          left: x + 1, top: 6,
                          width: w - 2, height: CH_H - 12,
                          borderRadius: 4,
                          overflow: 'hidden',
                          background: isCurrent
                            ? 'rgba(245,158,11,0.15)'
                            : isPast ? '#141414' : '#1e1e1e',
                          borderWidth: 1, borderStyle: 'solid',
                          borderColor: isCurrent ? '#f59e0b' : 'transparent',
                          display: 'flex', flexDirection: 'column', justifyContent: 'center',
                          padding: '0 8px',
                          cursor: 'default',
                        }}
                      >
                        <div style={{
                          fontSize: 12, fontWeight: isCurrent ? 600 : 400,
                          color: isCurrent ? '#fbbf24' : isPast ? '#444' : '#ccc',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {prog.title}
                        </div>
                        {w >= 120 && (
                          <div style={{
                            fontSize: 10, color: isCurrent ? '#92400e' : '#444',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            marginTop: 2,
                          }}>
                            {fmtHM(new Date(prog.startTime))} – {fmtHM(new Date(prog.endTime))}
                          </div>
                        )}
                        {isCurrent && typeof prog.progress === 'number' && (
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0,
                            height: 3, borderRadius: '0 0 4px 4px',
                            width: `${prog.progress}%`,
                            background: '#f59e0b',
                          }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes epg-shimmer {
          0%   { background-color: #1e1e1e; }
          50%  { background-color: #282828; }
          100% { background-color: #1e1e1e; }
        }
      `}</style>
    </div>
  );
}
