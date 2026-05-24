import type {
  XtreamCredentials,
  XtreamUserInfo,
  XtreamServerInfo,
  Channel,
  Movie,
  Series,
  Season,
  Category,
} from '@iptv/shared-types';
import { M3UParser } from './M3UParser';

export interface XtreamApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

export class XtreamService {
  private credentials: XtreamCredentials;
  private parser: M3UParser;
  private baseUrl: string;

  constructor(credentials: XtreamCredentials) {
    this.credentials = credentials;
    this.parser = new M3UParser({ maxChannels: 100_000 });
    this.baseUrl = credentials.serverUrl.replace(/\/$/, '');
  }

  // ── Auth ────────────────────────────────────────────────

  async authenticate(): Promise<{ userInfo: XtreamUserInfo; serverInfo: XtreamServerInfo }> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
    });

    const response = await this.get<{
      user_info: XtreamUserInfo;
      server_info: XtreamServerInfo;
    }>(url);

    if (!response.data) throw new Error(response.error || 'Falha na autenticação');
    if (response.data.user_info.auth !== 1) throw new Error('Credenciais inválidas');

    return {
      userInfo: response.data.user_info,
      serverInfo: response.data.server_info,
    };
  }

  // ── Live TV ─────────────────────────────────────────────

  async getLiveCategories(): Promise<Category[]> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_live_categories',
    });
    const res = await this.get<Array<{ category_id: string; category_name: string }>>(url);
    if (!res.data) return [];
    return res.data.map(c => ({ id: c.category_id, name: c.category_name }));
  }

  async getLiveStreams(categoryId?: string): Promise<Channel[]> {
    const params: Record<string, string> = {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_live_streams',
    };
    if (categoryId) params.category_id = categoryId;

    const url = this.buildUrl('player_api.php', params);
    const res = await this.get<unknown[]>(url);
    if (!res.data) return [];

    const categories = await this.getLiveCategories();
    const { channels } = this.parser.parseXtreamChannels(res.data, categories);

    // Adicionar URLs de stream
    return channels.map(ch => ({
      ...ch,
      streamUrl: this.buildStreamUrl(ch.streamId, 'ts'),
      streamUrlFallback: [
        this.buildStreamUrl(ch.streamId, 'm3u8'),
      ],
    }));
  }

  // ── VOD ─────────────────────────────────────────────────

  async getVODCategories(): Promise<Category[]> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_vod_categories',
    });
    const res = await this.get<Array<{ category_id: string; category_name: string }>>(url);
    if (!res.data) return [];
    return res.data.map(c => ({ id: c.category_id, name: c.category_name }));
  }

  async getVODStreams(categoryId?: string): Promise<Movie[]> {
    const params: Record<string, string> = {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_vod_streams',
    };
    if (categoryId) params.category_id = categoryId;

    const url = this.buildUrl('player_api.php', params);
    const res = await this.get<Array<{
      stream_id: number;
      name: string;
      stream_icon?: string;
      rating?: string;
      rating_5based?: number;
      added?: string;
      category_id?: string;
      container_extension?: string;
      custom_sid?: string;
      direct_source?: string;
    }>>(url);
    if (!res.data) return [];

    return res.data.map(m => ({
      id: `vod_${m.stream_id}`,
      name: m.name,
      streamId: String(m.stream_id),
      streamUrl: this.buildVODUrl(String(m.stream_id), m.container_extension || 'mp4'),
      streamType: 'vod_movie' as const,
      logo: m.stream_icon || '',
      rating: m.rating,
      categoryId: m.category_id,
      added: m.added,
      containerExtension: m.container_extension,
    }));
  }

  async getVODInfo(vodId: string): Promise<Partial<Movie>> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_vod_info',
      vod_id: vodId,
    });
    const res = await this.get<{ info: Record<string, unknown> }>(url);
    if (!res.data?.info) return {};

    const info = res.data.info;
    return {
      description: info.plot as string,
      director: info.director as string,
      cast: info.cast as string,
      duration: info.duration_secs as number,
      genre: info.genre as string,
      releaseDate: info.releaseDate as string,
      backdropPath: info.backdrop_path as string,
    };
  }

  // ── Séries ──────────────────────────────────────────────

  async getSeriesCategories(): Promise<Category[]> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_series_categories',
    });
    const res = await this.get<Array<{ category_id: string; category_name: string }>>(url);
    if (!res.data) return [];
    return res.data.map(c => ({ id: c.category_id, name: c.category_name }));
  }

  async getSeries(categoryId?: string): Promise<Series[]> {
    const params: Record<string, string> = {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_series',
    };
    if (categoryId) params.category_id = categoryId;

    const url = this.buildUrl('player_api.php', params);
    const res = await this.get<Array<{
      series_id: number;
      name: string;
      cover?: string;
      plot?: string;
      cast?: string;
      director?: string;
      genre?: string;
      releaseDate?: string;
      last_modified?: string;
      rating?: string;
      rating_5based?: number;
      backdrop_path?: string[];
      youtube_trailer?: string;
      episode_run_time?: string;
      category_id?: string;
    }>>(url);
    if (!res.data) return [];

    return res.data.map(s => ({
      id: `series_${s.series_id}`,
      name: s.name,
      seriesId: String(s.series_id),
      cover: s.cover,
      plot: s.plot,
      cast: s.cast,
      director: s.director,
      genre: s.genre,
      releaseDate: s.releaseDate,
      lastModified: s.last_modified,
      rating: s.rating,
      rating5Based: s.rating_5based,
      backdropPath: s.backdrop_path,
      youtubeTrailer: s.youtube_trailer,
      episodeRunTime: s.episode_run_time,
      categoryId: s.category_id,
    }));
  }

  async getSeriesInfo(seriesId: string): Promise<{ info: Partial<Series>; seasons: Season[] }> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_series_info',
      series_id: seriesId,
    });

    const res = await this.get<{
      info: Record<string, unknown>;
      episodes: Record<string, Array<{
        id: string;
        episode_num: number;
        title: string;
        container_extension: string;
        info?: Record<string, unknown>;
        custom_sid?: string;
        added?: string;
        season?: number;
      }>>;
    }>(url);

    if (!res.data) return { info: {}, seasons: [] };

    const seasons = new Map<number, Season>();

    Object.entries(res.data.episodes).forEach(([seasonKey, episodes]) => {
      const seasonNum = parseInt(seasonKey);
      const season: Season = {
        seasonNumber: seasonNum,
        name: `Temporada ${seasonNum}`,
        episodes: episodes.map(ep => ({
          id: ep.id,
          episodeNum: ep.episode_num,
          title: ep.title,
          containerExtension: ep.container_extension,
          streamUrl: this.buildEpisodeUrl(ep.id, ep.container_extension),
          customSid: ep.custom_sid,
          added: ep.added,
          seriesId,
          season: ep.season,
        })),
      };
      seasons.set(seasonNum, season);
    });

    return {
      info: res.data.info as Partial<Series>,
      seasons: Array.from(seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber),
    };
  }

  // ── EPG ─────────────────────────────────────────────────

  async getShortEPG(streamId: string, limit = 4): Promise<unknown> {
    const url = this.buildUrl('player_api.php', {
      username: this.credentials.username,
      password: this.credentials.password,
      action: 'get_short_epg',
      stream_id: streamId,
      limit: String(limit),
    });
    const res = await this.get<unknown>(url);
    return res.data;
  }

  // ── URL Builders ────────────────────────────────────────

  buildStreamUrl(streamId: string, extension = 'ts'): string {
    return `${this.baseUrl}/live/${this.credentials.username}/${this.credentials.password}/${streamId}.${extension}`;
  }

  buildVODUrl(vodId: string, extension = 'mp4'): string {
    return `${this.baseUrl}/movie/${this.credentials.username}/${this.credentials.password}/${vodId}.${extension}`;
  }

  buildEpisodeUrl(episodeId: string, extension = 'mp4'): string {
    return `${this.baseUrl}/series/${this.credentials.username}/${this.credentials.password}/${episodeId}.${extension}`;
  }

  // ── HTTP ────────────────────────────────────────────────

  private buildUrl(endpoint: string, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    return `${this.baseUrl}/${endpoint}?${qs}`;
  }

  private async get<T>(url: string): Promise<XtreamApiResponse<T>> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'IPTV-Pro/1.0' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { data: null, error: `HTTP ${res.status}`, success: false };
      }

      const data = await res.json() as T;
      return { data, error: null, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return { data: null, error: message, success: false };
    }
  }
}
