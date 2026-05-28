// ── HLS.js singleton ──────────────────────────────────────────────────────────
// Imported once at module load time and cached. All StreamLoader instances share
// the same resolved class, so channel switches never pay the dynamic-import cost.
type HlsCtor = Awaited<typeof import('hls.js')>['default'];
let _hlsReady: Promise<HlsCtor | null> | null = null;

function getHls(): Promise<HlsCtor | null> {
  if (!_hlsReady) {
    _hlsReady = import('hls.js')
      .then(m => (m.default.isSupported() ? m.default : null))
      .catch(() => null);
  }
  return _hlsReady;
}

// Pre-warm: kick off the HLS.js bundle fetch as soon as this module is evaluated
// so it's ready before the user clicks the first channel.
if (typeof window !== 'undefined') getHls();

// ── StreamLoader ───────────────────────────────────────────────────────────────
export class StreamLoader {
  private hls: unknown = null;
  private video: HTMLVideoElement;
  private aborted = false;
  private gen = 0;           // incremented on every load(); stale async ops abort via this
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private loadTimer:  ReturnType<typeof setTimeout> | null = null;
  private currentUrl = '';
  private onBufRef:   ((v: boolean) => void) | null = null;
  private onReadyRef: (() => void) | null = null;
  private onErrorRef: ((m: string, f: boolean) => void) | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async load(
    url: string,
    onReady:    () => void,
    onError:    (msg: string, fatal: boolean) => void,
    onBuffering: (v: boolean) => void,
  ) {
    if (!url?.trim()) { onError('URL do canal não disponível.', true); return; }
    this._abort();
    this.aborted    = false;
    this.retryCount = 0;
    this.currentUrl = url;
    this.onReadyRef = onReady;
    this.onErrorRef = onError;
    this.onBufRef   = onBuffering;
    const myGen = ++this.gen;
    await this._try(url, myGen);
  }

  // ── Internal: try each URL candidate in sequence ───────────────────────────

  private async _try(url: string, myGen: number) {
    if (this.aborted || this.gen !== myGen) return;
    const v = this.video;

    if (this.hls) { (this.hls as { destroy(): void }).destroy(); this.hls = null; }
    v.removeAttribute('src');
    v.load();

    for (const candidate of buildUrlCandidates(url)) {
      if (this.aborted || this.gen !== myGen) return;
      const ok = await this._loadOne(candidate, myGen);
      if (ok) { this._watchStall(); return; }
    }

    if (!this.aborted && this.gen === myGen) this._scheduleRetry(myGen);
  }

  // Resolves true on success, false on any failure.
  // Using a proper async function (not new Promise(async …)) so thrown exceptions
  // propagate as rejected promises instead of silently hanging.
  private async _loadOne(url: string, myGen: number): Promise<boolean> {
    if (this.aborted || this.gen !== myGen) return false;

    if (isHlsStream(url)) {
      const Hls = await getHls();                              // ≤1 ms after first load
      if (this.aborted || this.gen !== myGen) return false;
      if (Hls) return this._loadHls(url, myGen, Hls);
    }
    return this._loadNative(url, myGen);
  }

  // ── HLS.js path ───────────────────────────────────────────────────────────

  private _loadHls(url: string, myGen: number, Hls: HlsCtor): Promise<boolean> {
    return new Promise(resolve => {
      const v = this.video;
      let done = false;
      const finish = (ok: boolean) => {
        if (!done) {
          done = true;
          if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
          resolve(ok);
        }
      };

      if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
      const h = new Hls({
        // ── Buffer ────────────────────────────────────────────────────────────
        // 20 s ahead — absorbs typical IPTV segment delays (4–10 s each).
        // Does NOT delay playback start: video plays as soon as the first chunk arrives.
        maxBufferLength:    20,
        maxMaxBufferLength: 40,
        maxBufferSize: 30 * 1024 * 1024,
        // 1.5 s gap — IPTV streams routinely have small inter-segment gaps
        maxBufferHole: 1.5,
        // No back-buffer: live TV always plays forward
        backBufferLength: 0,

        // ── Worker ──
        enableWorker: true,

        // ── Live sync ─────────────────────────────────────────────────────────
        lowLatencyMode: false,
        liveSyncDurationCount:       3,   // 3 segs behind live edge = stable cushion
        liveMaxLatencyDurationCount: 10,  // resync after 10 segs of drift
        liveDurationInfinity: true,

        // ── ABR ──
        startLevel:       -1,   // auto (HLS.js picks best quality)
        abrEwmaFastLive:   3,
        abrEwmaSlowLive:   9,

        // ── Network ───────────────────────────────────────────────────────────
        // Manifest: 8 s gives transcoding-on-demand servers time to spin up.
        // maxRetry: 0 → HLS fires FATAL immediately at timeout; our guard at 10 s
        // is the final backstop (1.5× the timeout for safety).
        manifestLoadingTimeOut:      8_000,
        manifestLoadingMaxRetry:     0,
        manifestLoadingRetryDelay:   0,
        levelLoadingTimeOut:         8_000,
        levelLoadingMaxRetry:        0,
        levelLoadingRetryDelay:      0,
        // Fragments: be patient — IPTV servers can be slow on first segment,
        // and we have 20 s of buffer so a slow fragment is not immediately fatal.
        fragLoadingTimeOut:          20_000,
        fragLoadingMaxRetry:         4,
        fragLoadingRetryDelay:       1_000,
        fragLoadingMaxRetryTimeout:  8_000,
      });

      h.loadSource(proxyStreamUrl(url));
      h.attachMedia(v);

      h.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this.aborted || this.gen !== myGen) { h.destroy(); finish(false); return; }
        this.hls = h;
        v.play().catch(() => {});
        this.onReadyRef?.();
        this.onBufRef?.(false);
        finish(true);
      });

      h.on(Hls.Events.ERROR, (_: unknown, rawData: unknown) => {
        const d = rawData as {
          fatal?: boolean; type?: string; details?: string;
          response?: { code?: number };
        };
        if (this.aborted || done || this.gen !== myGen) { if (d.fatal) h.destroy(); return; }
        if (!d.fatal) return;

        // Permanent auth failures — don't retry
        const code = d.response?.code ?? 0;
        if (code === 403 || code === 404) {
          h.destroy(); this.hls = null; finish(false); return;
        }

        if (d.type === 'networkError') {
          const isManifest = (d.details ?? '').toLowerCase().includes('manifest');
          if (isManifest) {
            // Manifest errors can't be recovered with startLoad() — bail to next URL
            h.destroy(); this.hls = null; finish(false);
          } else {
            // Fragment/level error: jump to live edge before giving up
            try {
              const hh = h as unknown as { stopLoad(): void; startLoad(pos?: number): void };
              hh.stopLoad();
              hh.startLoad(-1);   // -1 = resume from live edge
            } catch { h.destroy(); this.hls = null; finish(false); }
          }
        } else if (d.type === 'mediaError') {
          try {
            (h as unknown as { recoverMediaError(): void }).recoverMediaError();
          } catch { h.destroy(); this.hls = null; finish(false); }
        } else {
          h.destroy(); this.hls = null; finish(false);
        }
      });

      // Final backstop: HLS.js should have fired FATAL at 8 s; 10 s catches edge cases
      this.loadTimer = setTimeout(() => {
        this.loadTimer = null;
        if (!done) { try { h.destroy(); } catch {} finish(false); }
      }, 10_000);
    });
  }

  // ── Native <video> path (MP4, Safari HLS, last-resort MPEG-TS) ────────────

  private _loadNative(url: string, myGen: number): Promise<boolean> {
    return new Promise(resolve => {
      if (this.aborted || this.gen !== myGen) { resolve(false); return; }
      const v = this.video;
      let done = false;
      const finish = (ok: boolean) => {
        if (!done) {
          done = true;
          if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
          resolve(ok);
        }
      };

      // Do NOT set crossOrigin here — the proxy is same-origin so CORS isn't needed.
      v.removeAttribute('crossorigin');
      v.src = proxyStreamUrl(url);
      v.load();

      const onOk  = () => { cleanup(); v.play().catch(() => {}); this.onReadyRef?.(); this.onBufRef?.(false); finish(true); };
      const onErr = () => { cleanup(); finish(false); };
      const cleanup = () => {
        v.removeEventListener('canplay', onOk);
        v.removeEventListener('error',   onErr);
      };
      v.addEventListener('canplay', onOk);
      v.addEventListener('error',   onErr);
      this.loadTimer = setTimeout(() => { this.loadTimer = null; cleanup(); finish(false); }, 10_000);
    });
  }

  // ── Stall detection & self-healing ────────────────────────────────────────

  private _watchStall() {
    this._clearStallTimer();
    const v = this.video;

    // Remove any existing stall listeners before re-adding to prevent accumulation
    const vr = v as unknown as Record<string, unknown>;
    if (vr['__sl_waiting']) { v.removeEventListener('waiting', vr['__sl_waiting'] as EventListener); }
    if (vr['__sl_playing']) { v.removeEventListener('playing', vr['__sl_playing'] as EventListener); }

    const onWaiting = () => {
      this._clearStallTimer();
      this.stallTimer = setTimeout(() => {
        if (this.aborted) return;
        if (this.hls) {
          // Jump to live edge instead of resuming from the stale position.
          // startLoad(-1) means "resume from live edge" in HLS.js.
          try {
            const h = this.hls as unknown as { stopLoad(): void; startLoad(pos?: number): void };
            h.stopLoad();
            h.startLoad(-1);
            return;
          } catch {}
        }
        // Native fallback: seek to seekable end (live edge)
        try {
          if (v.seekable.length > 0) {
            v.currentTime = v.seekable.end(v.seekable.length - 1);
            v.play().catch(() => {});
          } else {
            v.currentTime += 0.001;
          }
        } catch {}
      }, 8_000); // 8 s stall with 20 s buffer = real server problem, not transient hiccup
    };

    const onPlaying = () => this._clearStallTimer();

    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    vr['__sl_waiting'] = onWaiting;
    vr['__sl_playing'] = onPlaying;
  }

  private _clearStallTimer() {
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
  }

  // ── Retry scheduling ──────────────────────────────────────────────────────

  private _scheduleRetry(myGen: number) {
    if (this.retryCount >= this.MAX_RETRIES || this.aborted || this.gen !== myGen) {
      if (!this.aborted && this.gen === myGen) {
        this.onErrorRef?.('Mídia indisponível. Verifique a conexão ou tente outro canal.', true);
      }
      return;
    }
    this.retryCount++;
    // Fixed delays: 2 s / 5 s / 10 s — gives transcoding servers time to start up
    const delay = [2_000, 5_000, 10_000][this.retryCount - 1] ?? 10_000;
    this.onErrorRef?.(`Reconectando... (${this.retryCount}/${this.MAX_RETRIES})`, false);
    this.onBufRef?.(true);
    this.retryTimer = setTimeout(() => this._try(this.currentUrl, myGen), delay);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  abort() { this._abort(); }

  private _abort() {
    this.aborted = true;
    this._clearStallTimer();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.loadTimer)  { clearTimeout(this.loadTimer);  this.loadTimer  = null; }
    if (this.hls)        { (this.hls as { destroy(): void }).destroy(); this.hls = null; }

    const v  = this.video;
    const wr = (v as unknown as Record<string, unknown>)['__sl_waiting'];
    const pr = (v as unknown as Record<string, unknown>)['__sl_playing'];
    if (wr) { v.removeEventListener('waiting', wr as EventListener); delete (v as unknown as Record<string, unknown>)['__sl_waiting']; }
    if (pr) { v.removeEventListener('playing', pr as EventListener); delete (v as unknown as Record<string, unknown>)['__sl_playing']; }

    try { v.pause(); v.removeAttribute('src'); v.load(); } catch {}
  }
}

// ── URL helpers ───────────────────────────────────────────────────────────────

// Route http:// stream URLs through the Next.js server-side proxy so the browser
// never makes a Mixed Content request to an insecure IPTV server.
function proxyStreamUrl(url: string): string {
  if (url.startsWith('http://')) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function isHlsStream(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.endsWith('.m3u8') || p.endsWith('.m3u')) return true;
    if (p.endsWith('.ts'))                          return true;
    if (/\/live\/[^/]+\/[^/]+\/\d+/.test(p))       return true;
    return false;
  } catch {
    const low = url.toLowerCase().split('?')[0];
    return low.endsWith('.m3u8') || low.endsWith('.m3u') || low.endsWith('.ts');
  }
}

function buildUrlCandidates(url: string): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  const add  = (u: string) => { if (u && !seen.has(u)) { seen.add(u); list.push(u); } };

  if (url.endsWith('.m3u8') || url.endsWith('.m3u')) {
    // Already a playlist URL. The .ts sibling won't help if the server is down,
    // and costs 10 s of wasted timeout if the server returns raw TS. Skip it.
    add(url);

  } else if (url.endsWith('.ts')) {
    // .ts source: try .m3u8 first (HLS.js ABR), then direct .ts for native player
    add(url.replace(/\.ts$/, '.m3u8'));
    add(url);

  } else if (/\.(mp4|mkv|avi|mov|flv|webm|divx)$/i.test(url)) {
    // VOD file: always try HLS variant first — each segment is < 4 MB and completes
    // well within Vercel's 10 s function timeout. The direct file is tried as fallback
    // for servers that don't expose an .m3u8 playlist (e.g. non-Xtream CDN links).
    const m3u8 = url.replace(/\.(mp4|mkv|avi|mov|flv|webm|divx)$/i, '.m3u8');
    add(m3u8);
    add(url);

  } else {
    // Raw URL: Xtream-style /live/user/pass/id or unknown format
    if (/\/live\/[^/]+\/[^/]+\/\d+$/.test(url)) {
      // Some Xtream servers require the .m3u8 extension; try it first, then raw
      add(`${url}.m3u8`);
      add(url);
    } else {
      add(url);
    }
  }

  return list;
}
