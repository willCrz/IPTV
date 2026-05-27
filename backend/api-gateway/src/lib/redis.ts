export interface RedisLike {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttl: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  ping(): Promise<string>;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): this;
}

export class MemoryCache implements RedisLike {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.value;
  }

  async setEx(key: string, ttl: number, value: string) {
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async del(key: string | string[]) {
    const keys = Array.isArray(key) ? key : [key];
    keys.forEach(k => this.store.delete(k));
  }

  async ping() { return 'PONG'; }
  async connect() { /* no-op */ }
  async disconnect() { /* no-op */ }
  on(_event: string, _handler: (...args: unknown[]) => void): this { return this; }
}
