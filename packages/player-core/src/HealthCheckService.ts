import type { ServerHealth, ChannelHealth, HealthStatus } from '@iptv/shared-types';

export interface HealthCheckConfig {
  interval?: number;
  timeout?: number;
  serverUrl: string;
}

type HealthListener = (health: ServerHealth) => void;
type ChannelHealthListener = (health: ChannelHealth) => void;

export class HealthCheckService {
  private config: Required<HealthCheckConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<HealthListener>();
  private channelListeners = new Map<string, Set<ChannelHealthListener>>();
  private lastHealth: ServerHealth | null = null;
  private isRunning = false;

  constructor(config: HealthCheckConfig) {
    this.config = {
      interval: 30_000,
      timeout: 5_000,
      ...config,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.checkServer(); // Check imediato
    this.timer = setInterval(() => this.checkServer(), this.config.interval);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onHealthChange(listener: HealthListener): () => void {
    this.listeners.add(listener);
    if (this.lastHealth) listener(this.lastHealth);
    return () => this.listeners.delete(listener);
  }

  onChannelHealthChange(channelId: string, listener: ChannelHealthListener): () => void {
    if (!this.channelListeners.has(channelId)) {
      this.channelListeners.set(channelId, new Set());
    }
    this.channelListeners.get(channelId)!.add(listener);
    return () => this.channelListeners.get(channelId)?.delete(listener);
  }

  async checkServer(): Promise<ServerHealth> {
    const startTime = performance.now();
    let status: HealthStatus = 'unhealthy';
    let available = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const res = await fetch(`${this.config.serverUrl}/health/server`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      available = res.ok;
      status = res.ok ? 'healthy' : 'degraded';
    } catch {
      status = 'unhealthy';
      available = false;
    }

    const latencyMs = Math.round(performance.now() - startTime);
    const health: ServerHealth = {
      status,
      timestamp: Date.now(),
      latencyMs,
      available,
      responseTime: latencyMs,
    };

    this.lastHealth = health;
    this.listeners.forEach(l => l(health));
    return health;
  }

  async checkChannel(channelId: string, streamUrl: string): Promise<ChannelHealth> {
    const startTime = performance.now();
    let status: HealthStatus = 'unhealthy';
    let available = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      // HEAD request para verificar disponibilidade do stream
      const res = await fetch(streamUrl, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      available = res.ok || res.status === 405; // 405 = HEAD não suportado, stream existe
      status = available ? 'healthy' : 'unhealthy';
    } catch {
      status = 'unhealthy';
    }

    const latencyMs = Math.round(performance.now() - startTime);
    const health: ChannelHealth = {
      channelId,
      status,
      timestamp: Date.now(),
      latencyMs,
      available,
      responseTime: latencyMs,
      streamStatus: available ? 'online' : 'offline',
    };

    const listeners = this.channelListeners.get(channelId);
    if (listeners) listeners.forEach(l => l(health));

    return health;
  }

  getLastHealth(): ServerHealth | null { return this.lastHealth; }
  isHealthy(): boolean { return this.lastHealth?.status === 'healthy'; }
}
