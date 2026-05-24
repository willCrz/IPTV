import type { Platform } from '@iptv/shared-types';

export class PlatformDetector {
  private static _platform: Platform | null = null;

  static detect(): Platform {
    if (this._platform) return this._platform;

    // Forçado via env (build time)
    const envPlatform = process.env.NEXT_PUBLIC_PLATFORM as Platform | undefined;
    if (envPlatform && envPlatform !== 'web') {
      this._platform = envPlatform;
      return this._platform;
    }

    if (typeof window === 'undefined') {
      this._platform = 'web';
      return this._platform;
    }

    const ua = navigator.userAgent.toLowerCase();

    // Titan OS
    if ('tizen' in window || ua.includes('tizen')) {
      this._platform = 'tizen';
      return this._platform;
    }

    // LG webOS
    if ('webOS' in window || 'webOSSystem' in window || ua.includes('webos')) {
      this._platform = 'webos';
      return this._platform;
    }

    // Android TV / Google TV
    if (ua.includes('tv') || ua.includes('googletv')) {
      this._platform = ua.includes('googletv') ? 'googletv' : 'androidtv';
      return this._platform;
    }

    // Titan OS (hosted app check)
    if (ua.includes('titanos') || ('TitanApp' in window)) {
      this._platform = 'titan';
      return this._platform;
    }

    // TV Box (generic Android TV via screen resolution + input)
    if (window.screen.width >= 1280 && !('ontouchstart' in window) && window.innerWidth >= 1280) {
      const inputQuery = window.matchMedia?.('(hover: none) and (pointer: coarse)');
      if (!inputQuery?.matches) {
        // Big screen sem touch — provavelmente TV ou desktop
      }
    }

    // Mobile
    if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
      this._platform = 'mobile';
      return this._platform;
    }

    this._platform = 'web';
    return this._platform;
  }

  static isTVPlatform(): boolean {
    const p = this.detect();
    return ['titan', 'webos', 'tizen', 'androidtv', 'googletv', 'tvbox'].includes(p);
  }

  static isMobile(): boolean {
    return this.detect() === 'mobile';
  }

  static supportsAnimations(): boolean {
    // TVs de baixo custo — desabilitar animações pesadas
    const p = this.detect();
    if (['titan', 'tvbox'].includes(p)) return false;
    // Respeitar preferência do sistema
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  static supportsHover(): boolean {
    return !this.isTVPlatform() && !this.isMobile();
  }

  static getScreenSize(): 'sm' | 'md' | 'lg' | 'xl' | '4k' {
    if (typeof window === 'undefined') return 'lg';
    const w = window.screen.width;
    if (w >= 3840) return '4k';
    if (w >= 1920) return 'xl';
    if (w >= 1280) return 'lg';
    if (w >= 768) return 'md';
    return 'sm';
  }

  static reset(): void {
    this._platform = null;
  }
}
