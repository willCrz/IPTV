import type { Channel } from '@/store';

const DB_NAME  = 'iptv-cache';
const DB_VER   = 1;
const STORE    = 'channels';
const CACHE_KEY = 'main';
const MAX_AGE  = 24 * 3600_000; // 24 hours

export interface ChannelCacheEntry {
  playlistId: string;
  live:    Channel[];
  movies:  Channel[];
  series:  Channel[];
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no-idb')); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export async function saveChannelCache(
  playlistId: string,
  live: Channel[], movies: Channel[], series: Channel[],
): Promise<void> {
  try {
    const db = await openDB();
    const entry: ChannelCacheEntry = { playlistId, live, movies, series, savedAt: Date.now() };
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry, CACHE_KEY);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch { /* silently fail — cache is best-effort */ }
}

export async function loadChannelCache(playlistId: string): Promise<ChannelCacheEntry | null> {
  try {
    const db = await openDB();
    const entry = await new Promise<ChannelCacheEntry | undefined>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(CACHE_KEY);
      req.onsuccess = () => res(req.result as ChannelCacheEntry | undefined);
      req.onerror   = () => rej(req.error);
    });
    if (!entry) return null;
    if (entry.playlistId !== playlistId) return null;
    if (Date.now() - entry.savedAt > MAX_AGE) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function clearChannelCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(CACHE_KEY);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch { /* ignore */ }
}
