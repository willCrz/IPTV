interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  key: string;
}

// ── MemoryCache ──────────────────────────────────────────────
export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxSize) {
      // LRU simplificado: remover a entrada mais antiga
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { key, value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  delete(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  size(): number { return this.store.size; }

  prune(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) { this.store.delete(key); removed++; }
    }
    return removed;
  }
}

// ── CacheManager (facade com chain de camadas) ───────────────
export class CacheManager {
  private memory: MemoryCache;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;
  private readonly IDB_DB = 'iptv_cache';
  private readonly IDB_STORE = 'entries';
  private idb: IDBDatabase | null = null;

  constructor(options: { maxMemoryEntries?: number } = {}) {
    this.memory = new MemoryCache(options.maxMemoryEntries ?? 500);
    this.pruneInterval = setInterval(() => this.memory.prune(), 60_000);
    this.initIDB().catch(() => {/* IDB não disponível — só memória */});
  }

  async set<T>(key: string, value: T, ttlMs = 3_600_000): Promise<void> {
    this.memory.set(key, value, ttlMs);
    await this.idbSet(key, value, ttlMs).catch(() => {
      // Fallback: localStorage
      try {
        localStorage.setItem(`iptv_cache:${key}`, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
      } catch { /* storage full */ }
    });
  }

  async get<T>(key: string): Promise<T | null> {
    // L1: Memória
    const mem = this.memory.get<T>(key);
    if (mem !== null) return mem;

    // L2: IndexedDB
    try {
      const idbVal = await this.idbGet<T>(key);
      if (idbVal !== null) {
        this.memory.set(key, idbVal, 300_000); // warm L1 por 5min
        return idbVal;
      }
    } catch { /* continuar */ }

    // L3: localStorage
    try {
      const raw = localStorage.getItem(`iptv_cache:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { value: T; expiresAt: number };
        if (Date.now() < parsed.expiresAt) {
          this.memory.set(key, parsed.value, 300_000);
          return parsed.value;
        }
        localStorage.removeItem(`iptv_cache:${key}`);
      }
    } catch { /* localStorage não disponível */ }

    return null;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    await this.idbDelete(key).catch(() => {});
    try { localStorage.removeItem(`iptv_cache:${key}`); } catch { /* */ }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    await this.idbClear().catch(() => {});
    try {
      Object.keys(localStorage).filter(k => k.startsWith('iptv_cache:')).forEach(k => localStorage.removeItem(k));
    } catch { /* */ }
  }

  destroy(): void {
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.idb?.close();
  }

  // ── IndexedDB ─────────────────────────────────────────────

  private initIDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.IDB_DB, 1);
      req.onupgradeneeded = e => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.IDB_STORE)) {
          db.createObjectStore(this.IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { this.idb = (e.target as IDBOpenDBRequest).result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  private idbSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!this.idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = this.idb!.transaction(this.IDB_STORE, 'readwrite');
      const req = tx.objectStore(this.IDB_STORE).put({ key, value, expiresAt: Date.now() + ttlMs });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbGet<T>(key: string): Promise<T | null> {
    if (!this.idb) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const tx = this.idb!.transaction(this.IDB_STORE, 'readonly');
      const req = tx.objectStore(this.IDB_STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as { value: T; expiresAt: number } | undefined;
        if (!entry || Date.now() > entry.expiresAt) { resolve(null); return; }
        resolve(entry.value);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private idbDelete(key: string): Promise<void> {
    if (!this.idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = this.idb!.transaction(this.IDB_STORE, 'readwrite');
      const req = tx.objectStore(this.IDB_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbClear(): Promise<void> {
    if (!this.idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = this.idb!.transaction(this.IDB_STORE, 'readwrite');
      const req = tx.objectStore(this.IDB_STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
