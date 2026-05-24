import type { HealthStatus } from '@iptv/shared-types';

export interface StreamMetrics {
  channelId: string;
  bitrate: number;
  packetLoss: number;
  latencyMs: number;
  bufferHealth: number;
  status: HealthStatus;
  sampledAt: number;
}

export interface StreamMonitorOptions {
  sampleInterval?: number;
  historySize?: number;
  onMetrics?: (metrics: StreamMetrics) => void;
  onStatusChange?: (id: string, status: HealthStatus) => void;
}

export class StreamMonitor {
  private options: Required<StreamMonitorOptions>;
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private history = new Map<string, StreamMetrics[]>();
  private lastStatus = new Map<string, HealthStatus>();

  constructor(options: StreamMonitorOptions = {}) {
    this.options = {
      sampleInterval: 5000,
      historySize: 60,
      onMetrics: () => {},
      onStatusChange: () => {},
      ...options,
    };
  }

  startMonitoring(channelId: string, getMetrics: () => Partial<StreamMetrics>): void {
    this.stopMonitoring(channelId);

    const timer = setInterval(() => {
      const raw = getMetrics();
      const metrics: StreamMetrics = {
        channelId,
        bitrate: raw.bitrate ?? 0,
        packetLoss: raw.packetLoss ?? 0,
        latencyMs: raw.latencyMs ?? 0,
        bufferHealth: raw.bufferHealth ?? 0,
        status: this.computeStatus(raw),
        sampledAt: Date.now(),
      };

      // Histórico
      const hist = this.history.get(channelId) ?? [];
      hist.push(metrics);
      if (hist.length > this.options.historySize) hist.shift();
      this.history.set(channelId, hist);

      // Notificar mudança de status
      const prev = this.lastStatus.get(channelId);
      if (prev !== metrics.status) {
        this.lastStatus.set(channelId, metrics.status);
        this.options.onStatusChange(channelId, metrics.status);
      }

      this.options.onMetrics(metrics);
    }, this.options.sampleInterval);

    this.timers.set(channelId, timer);
  }

  stopMonitoring(channelId: string): void {
    const t = this.timers.get(channelId);
    if (t) { clearInterval(t); this.timers.delete(channelId); }
  }

  stopAll(): void {
    this.timers.forEach((_, id) => this.stopMonitoring(id));
  }

  getHistory(channelId: string): StreamMetrics[] {
    return this.history.get(channelId) ?? [];
  }

  getAverageBitrate(channelId: string, lastN = 10): number {
    const hist = this.getHistory(channelId).slice(-lastN);
    if (!hist.length) return 0;
    return hist.reduce((sum, m) => sum + m.bitrate, 0) / hist.length;
  }

  getLastMetrics(channelId: string): StreamMetrics | null {
    const hist = this.history.get(channelId);
    return hist?.at(-1) ?? null;
  }

  private computeStatus(m: Partial<StreamMetrics>): HealthStatus {
    if ((m.packetLoss ?? 0) > 10) return 'unhealthy';
    if ((m.packetLoss ?? 0) > 3 || (m.bufferHealth ?? 100) < 20) return 'degraded';
    if ((m.bitrate ?? 0) === 0 && (m.bufferHealth ?? 0) === 0) return 'unknown';
    return 'healthy';
  }
}
