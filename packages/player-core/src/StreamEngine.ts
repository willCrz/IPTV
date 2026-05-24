import Hls from 'hls.js';
import type { Channel, StreamHealth, Quality, AudioTrack, SubtitleTrack, PlayerError } from '@iptv/shared-types';
import { RetryService } from './RetryService';
import { FailoverService } from './FailoverService';

export interface StreamEngineConfig {
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  bufferSize?: number;
  enablePreload?: boolean;
  enableKeepAlive?: boolean;
  keepAliveInterval?: number;
  timeout?: number;
}

export interface StreamEngineEvents {
  onPlay?: () => void;
  onPause?: () => void;
  onBuffering?: (isBuffering: boolean) => void;
  onError?: (error: PlayerError) => void;
  onRecovered?: () => void;
  onQualityChange?: (quality: Quality) => void;
  onHealthUpdate?: (health: StreamHealth) => void;
  onLevelLoaded?: (bitrate: number) => void;
  onTrackChanged?: (type: 'audio' | 'subtitle', trackId: number) => void;
}

const DEFAULT_CONFIG: Required<StreamEngineConfig> = {
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  bufferSize: 30,
  enablePreload: true,
  enableKeepAlive: true,
  keepAliveInterval: 30000,
  timeout: 10000,
};

export class StreamEngine {
  private hls: Hls | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private currentChannel: Channel | null = null;
  private preloadHls: Hls | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private healthMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private config: Required<StreamEngineConfig>;
  private events: StreamEngineEvents;
  private retryService: RetryService;
  private failoverService: FailoverService;
  private health: StreamHealth;
  private isDestroyed = false;
  private lastBitrate = 0;
  private droppedFrames = 0;

  constructor(config: StreamEngineConfig = {}, events: StreamEngineEvents = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
    this.retryService = new RetryService({
      maxAttempts: this.config.maxReconnectAttempts,
      initialDelay: this.config.reconnectDelay,
      maxDelay: 30000,
      backoffMultiplier: 2,
    });
    this.failoverService = new FailoverService();
    this.health = this.createInitialHealth();
  }

  // ── Inicialização ───────────────────────────────────────

  attach(videoElement: HTMLVideoElement): void {
    this.videoElement = videoElement;
    this.setupVideoListeners();
  }

  async load(channel: Channel): Promise<void> {
    if (this.isDestroyed) return;

    this.currentChannel = channel;
    this.retryService.reset();
    this.failoverService.setUrls([
      channel.streamUrl,
      ...(channel.streamUrlFallback || []),
    ]);

    await this.startStream(channel.streamUrl);
    this.startHealthMonitor();
    if (this.config.enableKeepAlive) this.startKeepAlive();
  }

  private async startStream(url: string): Promise<void> {
    if (!this.videoElement || this.isDestroyed) return;

    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = this.createHlsInstance();
      this.setupHlsListeners();
      this.hls.loadSource(url);
      this.hls.attachMedia(this.videoElement);
    } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS native HLS
      this.videoElement.src = url;
      this.videoElement.load();
    } else {
      // Fallback direto (TS streams, etc.)
      this.videoElement.src = url;
      this.videoElement.load();
    }

    try {
      await this.videoElement.play();
      this.events.onPlay?.();
    } catch (e) {
      // autoplay blocked — usuário terá que clicar
    }
  }

  // ── HLS Instance ────────────────────────────────────────

  private createHlsInstance(): Hls {
    return new Hls({
      // Buffer
      maxBufferLength: this.config.bufferSize,
      maxMaxBufferLength: this.config.bufferSize * 2,
      maxBufferSize: 60 * 1000 * 1000, // 60MB
      maxBufferHole: 0.5,

      // Fragmentos
      fragLoadingTimeOut: this.config.timeout,
      fragLoadingMaxRetry: 3,
      fragLoadingRetryDelay: 500,
      fragLoadingMaxRetryTimeout: 64000,

      // Manifest
      manifestLoadingTimeOut: this.config.timeout,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 500,

      // Level (qualidade)
      levelLoadingTimeOut: this.config.timeout,
      levelLoadingMaxRetry: 2,

      // ABR (adaptive bitrate)
      startLevel: -1, // auto
      autoStartLoad: true,
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      abrEwmaFastVoD: 3,
      abrEwmaSlowVoD: 9,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,

      // Low latency
      lowLatencyMode: false, // habilitar para streams LL-HLS

      // Recuperação
      enableWorker: true,
      backBufferLength: 30,

      xhrSetup: (xhr) => {
        xhr.timeout = this.config.timeout;
      },
    });
  }

  private setupHlsListeners(): void {
    if (!this.hls) return;

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.retryService.reset();
      this.updateHealth({ status: 'healthy' });
    });

    this.hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      const bitrate = data.frag.stats.loading.end > 0
        ? (data.frag.stats.total * 8) / ((data.frag.stats.loading.end - data.frag.stats.loading.start) / 1000)
        : 0;
      if (bitrate > 0) {
        this.lastBitrate = bitrate;
        this.events.onLevelLoaded?.(bitrate);
      }
    });

    this.hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = this.hls?.levels[data.level];
      if (level) {
        const q = this.bitrateToQuality(level.bitrate);
        this.events.onQualityChange?.(q);
      }
    });

    this.hls.on(Hls.Events.ERROR, async (_event, data) => {
      if (this.isDestroyed) return;

      this.updateHealth({ status: data.fatal ? 'unhealthy' : 'degraded' });

      if (!data.fatal) {
        // Erro não-fatal: HLS.js se recupera sozinho
        return;
      }

      const error: PlayerError = {
        code: data.type,
        message: data.details,
        fatal: data.fatal,
        timestamp: Date.now(),
      };

      this.events.onError?.(error);

      await this.handleFatalError(data.type);
    });

    this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
      this.events.onTrackChanged?.('audio', data.id);
    });

    this.hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
      this.events.onTrackChanged?.('subtitle', data.id);
    });
  }

  private async handleFatalError(type: string): Promise<void> {
    if (type === Hls.ErrorTypes.NETWORK_ERROR) {
      // Tentar reconectar com retry exponencial
      try {
        await this.retryService.execute(async () => {
          const nextUrl = this.failoverService.getNextUrl();
          await this.startStream(nextUrl);
          this.events.onRecovered?.();
          this.updateHealth({ status: 'healthy', reconnect_count: this.health.reconnect_count + 1 });
        });
      } catch {
        this.updateHealth({ status: 'unhealthy' });
      }
    } else if (type === Hls.ErrorTypes.MEDIA_ERROR) {
      // Tentar recover de erro de media
      if (this.hls) {
        this.hls.recoverMediaError();
      }
    }
  }

  // ── Video Element Listeners ──────────────────────────────

  private setupVideoListeners(): void {
    if (!this.videoElement) return;
    const v = this.videoElement;

    v.addEventListener('waiting', () => {
      this.events.onBuffering?.(true);
      this.updateHealth({ status: 'degraded' });
    });

    v.addEventListener('playing', () => {
      this.events.onBuffering?.(false);
      this.updateHealth({ status: 'healthy' });
    });

    v.addEventListener('pause', () => {
      this.events.onPause?.();
    });

    v.addEventListener('error', async () => {
      if (this.isDestroyed || this.hls) return; // HLS.js já trata
      await this.handleFatalError(Hls.ErrorTypes.NETWORK_ERROR);
    });
  }

  // ── Preload Próximo Canal ────────────────────────────────

  async preload(channel: Channel): Promise<void> {
    if (!this.config.enablePreload || this.isDestroyed) return;
    if (this.preloadHls) {
      this.preloadHls.destroy();
      this.preloadHls = null;
    }

    if (!Hls.isSupported()) return;

    const preloadVideo = document.createElement('video');
    preloadVideo.muted = true;
    preloadVideo.preload = 'auto';

    this.preloadHls = this.createHlsInstance();
    this.preloadHls.loadSource(channel.streamUrl);
    this.preloadHls.attachMedia(preloadVideo);

    // Preload só o manifest + primeiro fragmento
    this.preloadHls.on(Hls.Events.FRAG_LOADED, () => {
      // Primeiro fragmento carregado — suficiente para zapping rápido
    });
  }

  // ── Controles ───────────────────────────────────────────

  play(): void {
    this.videoElement?.play().catch(() => {});
  }

  pause(): void {
    this.videoElement?.pause();
  }

  seek(time: number): void {
    if (this.videoElement) this.videoElement.currentTime = time;
  }

  setVolume(volume: number): void {
    if (this.videoElement) {
      this.videoElement.volume = Math.max(0, Math.min(1, volume));
    }
  }

  mute(): void {
    if (this.videoElement) this.videoElement.muted = true;
  }

  unmute(): void {
    if (this.videoElement) this.videoElement.muted = false;
  }

  setQuality(quality: Quality): void {
    if (!this.hls) return;
    if (quality === 'auto') {
      this.hls.currentLevel = -1;
    } else {
      const targetBitrate = this.qualityToBitrate(quality);
      const levelIndex = this.hls.levels.findIndex(l => l.bitrate <= targetBitrate);
      if (levelIndex >= 0) this.hls.currentLevel = levelIndex;
    }
  }

  setAudioTrack(trackId: number): void {
    if (this.hls) this.hls.audioTrack = trackId;
  }

  setSubtitleTrack(trackId: number): void {
    if (this.hls) this.hls.subtitleTrack = trackId;
  }

  getAudioTracks(): AudioTrack[] {
    if (!this.hls) return [];
    return this.hls.audioTracks.map((t, i) => ({
      id: i,
      name: t.name || t.lang || `Audio ${i + 1}`,
      language: t.lang,
      default: t.default,
    }));
  }

  getSubtitleTracks(): SubtitleTrack[] {
    if (!this.hls) return [];
    return this.hls.subtitleTracks.map((t, i) => ({
      id: i,
      name: t.name || t.lang || `Subtitle ${i + 1}`,
      language: t.lang,
      forced: t.forced,
    }));
  }

  getAvailableQualities(): Quality[] {
    if (!this.hls?.levels?.length) return ['auto'];
    const qualities: Quality[] = ['auto'];
    this.hls.levels.forEach(level => {
      const q = this.bitrateToQuality(level.bitrate);
      if (!qualities.includes(q)) qualities.push(q);
    });
    return qualities;
  }

  // ── Keep Alive ──────────────────────────────────────────

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.videoElement || this.isDestroyed) return;
      const isStuck = !this.videoElement.paused &&
        this.videoElement.currentTime === (this.videoElement as HTMLVideoElement & { _lastTime?: number })._lastTime;
      (this.videoElement as HTMLVideoElement & { _lastTime?: number })._lastTime = this.videoElement.currentTime;

      if (isStuck && this.currentChannel) {
        // Stream travado — reconectar
        this.load(this.currentChannel);
      }
    }, this.config.keepAliveInterval);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ── Health Monitor ──────────────────────────────────────

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthMonitorTimer = setInterval(() => {
      if (!this.videoElement || this.isDestroyed) return;
      const quality = this.videoElement.getVideoPlaybackQuality?.();
      if (quality) {
        this.droppedFrames = quality.droppedVideoFrames;
      }
      this.updateHealth({
        bitrate: this.lastBitrate,
        dropped_frames: this.droppedFrames,
        buffer_length: this.getBufferLength(),
        last_check: Date.now(),
      });
      this.events.onHealthUpdate?.(this.health);
    }, 5000);
  }

  private stopHealthMonitor(): void {
    if (this.healthMonitorTimer) {
      clearInterval(this.healthMonitorTimer);
      this.healthMonitorTimer = null;
    }
  }

  private getBufferLength(): number {
    if (!this.videoElement) return 0;
    const buffered = this.videoElement.buffered;
    if (buffered.length === 0) return 0;
    return buffered.end(buffered.length - 1) - this.videoElement.currentTime;
  }

  // ── Utils ───────────────────────────────────────────────

  private bitrateToQuality(bitrate: number): Quality {
    if (bitrate >= 8_000_000) return '4k';
    if (bitrate >= 4_000_000) return '1080p';
    if (bitrate >= 2_000_000) return '720p';
    if (bitrate >= 800_000) return '480p';
    return '360p';
  }

  private qualityToBitrate(quality: Quality): number {
    const map: Record<Quality, number> = {
      '4k': 8_000_000,
      '1080p': 4_000_000,
      '720p': 2_000_000,
      '480p': 800_000,
      '360p': 400_000,
      'auto': 0,
    };
    return map[quality] ?? 0;
  }

  private createInitialHealth(): StreamHealth {
    return {
      status: 'unknown',
      bitrate: 0,
      dropped_frames: 0,
      buffer_length: 0,
      latency_ms: 0,
      reconnect_count: 0,
      last_check: Date.now(),
    };
  }

  private updateHealth(partial: Partial<StreamHealth>): void {
    this.health = { ...this.health, ...partial };
  }

  // ── Cleanup ─────────────────────────────────────────────

  private destroyHls(): void {
    if (this.hls) {
      this.hls.stopLoad();
      this.hls.detachMedia();
      this.hls.destroy();
      this.hls = null;
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopKeepAlive();
    this.stopHealthMonitor();
    this.destroyHls();
    if (this.preloadHls) {
      this.preloadHls.destroy();
      this.preloadHls = null;
    }
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement.load();
    }
  }

  // ── Getters ─────────────────────────────────────────────

  getHealth(): StreamHealth { return { ...this.health }; }
  getCurrentChannel(): Channel | null { return this.currentChannel; }
  isHlsSupported(): boolean { return Hls.isSupported(); }
}
