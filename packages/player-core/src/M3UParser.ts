import type { Channel, Category } from '@iptv/shared-types';

export interface M3UParseResult {
  channels: Channel[];
  categories: Category[];
  errors: string[];
  parseTimeMs: number;
}

export interface M3UParserOptions {
  maxChannels?: number;
  deduplicateByName?: boolean;
  validateUrls?: boolean;
}

// Regex otimizados para parsing de M3U
const EXTINF_RE = /^#EXTINF:(-?\d+(?:\.\d+)?)\s*(.*),(.+)$/;
const ATTR_RE = /(\S+?)="([^"]*?)"/g;

export class M3UParser {
  private options: Required<M3UParserOptions>;

  constructor(options: M3UParserOptions = {}) {
    this.options = {
      maxChannels: 50_000,
      deduplicateByName: false,
      validateUrls: false,
      ...options,
    };
  }

  parse(content: string): M3UParseResult {
    const start = performance.now();
    const channels: Channel[] = [];
    const categories = new Map<string, Category>();
    const errors: string[] = [];
    const seenNames = new Set<string>();

    const lines = content.split(/\r?\n/);

    if (!lines[0]?.startsWith('#EXTM3U')) {
      errors.push('Arquivo não começa com #EXTM3U — pode não ser um M3U válido');
    }

    let i = 0;
    let channelCount = 0;

    while (i < lines.length && channelCount < this.options.maxChannels) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        const match = EXTINF_RE.exec(line);
        if (!match) {
          i++;
          continue;
        }

        const [, , attrsStr, name] = match;
        const attrs = this.parseAttributes(attrsStr);
        const streamUrl = this.findNextUrl(lines, i + 1);

        if (!streamUrl) {
          i++;
          continue;
        }

        if (this.options.deduplicateByName && seenNames.has(name.trim())) {
          i++;
          continue;
        }

        const groupTitle = attrs['group-title'] ?? attrs['tvg-group'] ?? 'Sem Categoria';
        const channelName = name.trim();

        // Registrar categoria
        if (!categories.has(groupTitle)) {
          categories.set(groupTitle, {
            id: this.slugify(groupTitle),
            name: groupTitle,
            channelCount: 0,
          });
        }
        const cat = categories.get(groupTitle)!;
        cat.channelCount = (cat.channelCount ?? 0) + 1;

        const channel: Channel = {
          id: `m3u_${channelCount}_${Date.now()}`,
          name: channelName,
          streamId: attrs['tvg-id'] || attrs['tvg-name'] || this.slugify(channelName),
          streamType: 'live',
          streamUrl,
          logo: attrs['tvg-logo'] || attrs['logo'] || '',
          groupTitle,
          categoryId: this.slugify(groupTitle),
          tvgId: attrs['tvg-id'],
          tvgName: attrs['tvg-name'],
          num: attrs['tvg-chno'] ? parseInt(attrs['tvg-chno']) : undefined,
          epgChannelId: attrs['tvg-id'],
          tvgShift: attrs['tvg-shift'] ? parseFloat(attrs['tvg-shift']) : 0,
        };

        if (this.options.validateUrls && !this.isValidUrl(streamUrl)) {
          errors.push(`URL inválida para canal "${channelName}": ${streamUrl}`);
        } else {
          channels.push(channel);
          seenNames.add(channelName);
          channelCount++;
        }
      }

      i++;
    }

    if (channelCount >= this.options.maxChannels) {
      errors.push(`Limite de ${this.options.maxChannels} canais atingido — M3U truncada`);
    }

    return {
      channels,
      categories: Array.from(categories.values()),
      errors,
      parseTimeMs: Math.round(performance.now() - start),
    };
  }

  // Parse de URL remota com fetch
  async parseFromUrl(url: string): Promise<M3UParseResult> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'IPTV-Pro/1.0',
        Accept: 'application/x-mpegurl, audio/x-mpegurl, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao baixar M3U: ${url}`);
    }

    const content = await response.text();
    return this.parse(content);
  }

  // Parse de Xtream Codes API (formato JSON)
  parseXtreamChannels(
    liveStreams: unknown[],
    categories: unknown[]
  ): { channels: Channel[]; categories: Category[] } {
    const catMap = new Map<string, Category>();
    const parsedChannels: Channel[] = [];

    // Processar categorias
    (categories as Array<{ category_id: string; category_name: string }>).forEach(cat => {
      catMap.set(cat.category_id, {
        id: cat.category_id,
        name: cat.category_name,
        channelCount: 0,
      });
    });

    // Processar canais
    (liveStreams as Array<{
      stream_id: number;
      name: string;
      stream_icon?: string;
      category_id?: string;
      epg_channel_id?: string;
      added?: string;
      custom_sid?: string;
      tv_archive?: number;
      direct_source?: string;
      tv_archive_duration?: number;
      num?: number;
    }>).forEach(stream => {
      const cat = stream.category_id ? catMap.get(stream.category_id) : null;
      if (cat) cat.channelCount = (cat.channelCount ?? 0) + 1;

      parsedChannels.push({
        id: `xt_${stream.stream_id}`,
        name: stream.name,
        streamId: String(stream.stream_id),
        streamType: 'live',
        streamUrl: '', // preenchido pelo XtreamService
        logo: stream.stream_icon || '',
        categoryId: stream.category_id,
        epgChannelId: stream.epg_channel_id,
        added: stream.added,
        customSid: stream.custom_sid,
        num: stream.num,
        groupTitle: cat?.name || 'Sem Categoria',
      });
    });

    return {
      channels: parsedChannels,
      categories: Array.from(catMap.values()),
    };
  }

  private parseAttributes(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    let match: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(attrStr)) !== null) {
      attrs[match[1].toLowerCase()] = match[2];
    }
    return attrs;
  }

  private findNextUrl(lines: string[], startIdx: number): string {
    for (let i = startIdx; i < Math.min(startIdx + 3, lines.length); i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#')) {
        return line;
      }
    }
    return '';
  }

  private isValidUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return ['http:', 'https:', 'rtmp:', 'rtsp:', 'udp:'].includes(u.protocol);
    } catch {
      return false;
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 64);
  }
}
