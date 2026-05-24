// ============================================================
// @iptv/shared-types — Tipos compartilhados entre todos os packages
// ============================================================

// ── Plataformas ─────────────────────────────────────────────
export type Platform =
  | 'web'
  | 'mobile'
  | 'titan'
  | 'webos'
  | 'tizen'
  | 'androidtv'
  | 'googletv'
  | 'tvbox';

export type StreamType = 'live' | 'vod_movie' | 'vod_series';
export type VideoFormat = 'hls' | 'dash' | 'mp4' | 'ts' | 'rtmp' | 'rtsp';
export type Quality = 'auto' | '4k' | '1080p' | '720p' | '480p' | '360p';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// ── Autenticação ────────────────────────────────────────────
export interface UserCredentials {
  username: string;
  password: string;
  serverUrl: string;
}

export interface XtreamCredentials extends UserCredentials {
  type: 'xtream';
}

export interface M3UCredentials {
  type: 'm3u';
  url: string;
  name?: string;
}

export type PlaylistCredentials = XtreamCredentials | M3UCredentials;

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: number;
  credentials: PlaylistCredentials;
}

export interface XtreamUserInfo {
  username: string;
  password: string;
  message: string;
  auth: number;
  status: string;
  expDate: string | null;
  isTrial: string;
  activeCons: string;
  createdAt: string;
  maxConnections: string;
  allowedOutputFormats: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  httpsPort: string;
  serverProtocol: string;
  rtmpPort: string;
  timezone: string;
  timestampNow: number;
  timeNow: string;
}

// ── Playlist ────────────────────────────────────────────────
export interface Playlist {
  id: string;
  name: string;
  type: 'xtream' | 'm3u';
  serverUrl?: string;
  username?: string;
  password?: string;
  m3uUrl?: string;
  status: 'active' | 'inactive' | 'error' | 'loading';
  lastUpdated: number;
  latencyMs?: number;
  channelCount?: number;
  movieCount?: number;
  seriesCount?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Categoria ───────────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  channelCount?: number;
}

// ── Canal ───────────────────────────────────────────────────
export interface Channel {
  id: string;
  name: string;
  streamId: string;
  streamType: StreamType;
  streamUrl: string;
  streamUrlFallback?: string[];
  logo?: string;
  groupTitle?: string;
  categoryId?: string;
  epgChannelId?: string;
  tvgId?: string;
  tvgName?: string;
  num?: number;
  added?: string;
  customSid?: string;
  tvgShift?: number;
  isFavorite?: boolean;
  isHidden?: boolean;
  lastWatched?: number;
  watchCount?: number;
  format?: VideoFormat;
}

// ── EPG ─────────────────────────────────────────────────────
export interface EPGProgram {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  genre?: string;
  rating?: string;
  thumbnail?: string;
  isCurrent?: boolean;
}

export interface EPGChannel {
  id: string;
  name: string;
  icon?: string;
  programs: EPGProgram[];
}

// ── Filme ───────────────────────────────────────────────────
export interface Movie {
  id: string;
  name: string;
  streamId: string;
  streamUrl: string;
  streamType: 'vod_movie';
  logo?: string;
  backdropPath?: string;
  releaseDate?: string;
  rating?: string;
  duration?: number;
  genre?: string;
  categoryId?: string;
  added?: string;
  containerExtension?: string;
  description?: string;
  director?: string;
  cast?: string;
  lastWatched?: number;
  watchedDuration?: number;
  isFavorite?: boolean;
}

// ── Série ───────────────────────────────────────────────────
export interface Series {
  id: string;
  name: string;
  seriesId: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  lastModified?: string;
  rating?: string;
  rating5Based?: number;
  backdropPath?: string[];
  youtubeTrailer?: string;
  episodeRunTime?: string;
  categoryId?: string;
  isFavorite?: boolean;
}

export interface Season {
  seasonNumber: number;
  name: string;
  episodes: Episode[];
  airDate?: string;
  overview?: string;
  coverPath?: string;
}

export interface Episode {
  id: string;
  episodeNum: number;
  title: string;
  containerExtension: string;
  streamUrl: string;
  info?: EpisodeInfo;
  customSid?: string;
  added?: string;
  seriesId?: string;
  season?: number;
  watchedDuration?: number;
  totalDuration?: number;
}

export interface EpisodeInfo {
  airDate?: string;
  rating?: string;
  votes?: string;
  durationSecs?: number;
  duration?: string;
  video?: VideoInfo;
  audio?: AudioInfo;
  bitrate?: number;
  plot?: string;
  movieImage?: string;
  releaseDate?: string;
  tmdbId?: string;
}

export interface VideoInfo {
  index?: number;
  codecName?: string;
  codecLongName?: string;
  profile?: string;
  codecType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  fps?: string;
}

export interface AudioInfo {
  index?: number;
  codecName?: string;
  codecLongName?: string;
  sampleRate?: string;
  channels?: number;
  bitrate?: number;
}

// ── Player ──────────────────────────────────────────────────
export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isFullscreen: boolean;
  isMuted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  buffered: number;
  quality: Quality;
  availableQualities: Quality[];
  audioTrack: number;
  availableAudioTracks: AudioTrack[];
  subtitleTrack: number;
  availableSubtitleTracks: SubtitleTrack[];
  error?: PlayerError;
  streamHealth: StreamHealth;
}

export interface AudioTrack {
  id: number;
  name: string;
  language?: string;
  default?: boolean;
}

export interface SubtitleTrack {
  id: number;
  name: string;
  language?: string;
  forced?: boolean;
}

export interface PlayerError {
  code: string;
  message: string;
  fatal: boolean;
  timestamp: number;
}

export interface StreamHealth {
  status: HealthStatus;
  bitrate: number;
  dropped_frames: number;
  buffer_length: number;
  latency_ms: number;
  reconnect_count: number;
  last_check: number;
}

// ── Configurações ───────────────────────────────────────────
export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  language: string;
  player: PlayerSettings;
  cache: CacheSettings;
  network: NetworkSettings;
  ui: UISettings;
  platform: PlatformSettings;
}

export interface PlayerSettings {
  defaultQuality: Quality;
  autoplay: boolean;
  rememberPosition: boolean;
  hardwareAcceleration: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  bufferSize: number;
  preloadNextChannel: boolean;
  zappingMode: 'fast' | 'normal';
}

export interface CacheSettings {
  enabled: boolean;
  maxSizeMB: number;
  playlistTTLMinutes: number;
  imageCacheTTLHours: number;
  epgCacheTTLHours: number;
}

export interface NetworkSettings {
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  fallbackEnabled: boolean;
  healthCheckInterval: number;
}

export interface UISettings {
  animations: boolean;
  channelNumberDisplay: boolean;
  clockDisplay: boolean;
  epgEnabled: boolean;
  focusScale: number;
}

export interface PlatformSettings {
  platform: Platform;
  tvNavigationMode: boolean;
  cursorMode: boolean;
  overscan: number;
}

// ── Health Check ────────────────────────────────────────────
export interface ServerHealth {
  status: HealthStatus;
  timestamp: number;
  latencyMs: number;
  available: boolean;
  responseTime: number;
}

export interface ChannelHealth extends ServerHealth {
  channelId: string;
  bitrate?: number;
  packetLoss?: number;
  streamStatus: 'online' | 'offline' | 'degraded';
}

// ── Histórico ───────────────────────────────────────────────
export interface WatchHistoryItem {
  id: string;
  contentId: string;
  contentType: StreamType;
  title: string;
  logo?: string;
  watchedAt: number;
  duration?: number;
  position?: number;
}

// ── API Responses ────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  timestamp: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

// ── Eventos ─────────────────────────────────────────────────
export type AppEvent =
  | { type: 'CHANNEL_CHANGED'; payload: Channel }
  | { type: 'PLAYER_ERROR'; payload: PlayerError }
  | { type: 'STREAM_RECOVERED'; payload: { channelId: string } }
  | { type: 'PLAYLIST_UPDATED'; payload: { playlistId: string } }
  | { type: 'HEALTH_CHANGED'; payload: ServerHealth }
  | { type: 'PLATFORM_DETECTED'; payload: Platform };
