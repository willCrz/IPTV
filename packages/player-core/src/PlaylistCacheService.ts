import type { Channel, Movie, Series, Category } from '@iptv/shared-types';

interface CachedPlaylist {
  id: string;
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  categories: Category[];
  cachedAt: number;
  ttlMs: number;
  version: string;
}

export class PlaylistCacheService {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'iptv_pro_cache';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'playlists';
  private memCache = new Map<string, CachedPlaylist>();
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.openDB();
    return this.initPromise;
  }

  private openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        // SSR ou plataforma sem IndexedDB — usar só memória
        resolve();
        return;
      }

      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('cachedAt', 'cachedAt');
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async set(
    playlistId: string,
    data: Omit<CachedPlaylist, 'id' | 'cachedAt'>,
    ttlMs = 3_600_000 // 1 hora
  ): Promise<void> {
    const entry: CachedPlaylist = {
      id: playlistId,
      cachedAt: Date.now(),
      ttlMs,
      ...data,
    };

    // Sempre salvar na memória
    this.memCache.set(playlistId, entry);

    // Salvar no IndexedDB se disponível
    if (this.db) {
      await this.idbPut(entry);
    }
  }

  async get(playlistId: string): Promise<CachedPlaylist | null> {
    // Verificar memória primeiro (mais rápido)
    const memEntry = this.memCache.get(playlistId);
    if (memEntry && !this.isExpired(memEntry)) {
      return memEntry;
    }

    // Tentar IndexedDB
    if (this.db) {
      const entry = await this.idbGet(playlistId);
      if (entry && !this.isExpired(entry)) {
        this.memCache.set(playlistId, entry); // hot cache
        return entry;
      }
    }

    return null;
  }

  async delete(playlistId: string): Promise<void> {
    this.memCache.delete(playlistId);
    if (this.db) await this.idbDelete(playlistId);
  }

  async clear(): Promise<void> {
    this.memCache.clear();
    if (this.db) await this.idbClearAll();
  }

  async getStorageStats(): Promise<{ count: number; sizeKB: number }> {
    const count = this.memCache.size;
    const sizeKB = Math.round(
      JSON.stringify([...this.memCache.values()]).length / 1024
    );
    return { count, sizeKB };
  }

  private isExpired(entry: CachedPlaylist): boolean {
    return Date.now() - entry.cachedAt > entry.ttlMs;
  }

  // ── IndexedDB helpers ───────────────────────────────────

  private idbPut(entry: CachedPlaylist): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const req = tx.objectStore(this.STORE_NAME).put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbGet(id: string): Promise<CachedPlaylist | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readonly');
      const req = tx.objectStore(this.STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as CachedPlaylist ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private idbDelete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const req = tx.objectStore(this.STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbClearAll(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.STORE_NAME, 'readwrite');
      const req = tx.objectStore(this.STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
