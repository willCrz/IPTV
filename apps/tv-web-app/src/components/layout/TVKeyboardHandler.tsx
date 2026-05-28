'use client';
import { useEffect } from 'react';

// ── Focusable element selector ────────────────────────────
const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex="0"]',
].join(', ');

// ── Platform key codes ────────────────────────────────────
const BACK_KEYS  = new Set(['GoBack', 'BrowserBack']);
const BACK_CODES = new Set([461, 10009, 166]); // WebOS, Tizen, BrowserBack

const MEDIA_KEYS = new Set([
  'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
  'MediaFastForward', 'MediaRewind',
]);
const MEDIA_CODES = new Set([415, 19, 179, 178, 227, 228]);

type NavDir = 'up' | 'down' | 'left' | 'right';

// ── TV detection ──────────────────────────────────────────
function detectTV(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  if ('tizen' in window || ua.includes('tizen')) return true;
  if ('webOS' in window || 'webOSSystem' in window || ua.includes('webos')) return true;
  if (ua.includes('googletv') || ua.includes('crkey')) return true;
  if ('TitanApp' in window || ua.includes('titanos')) return true;
  if (ua.includes(' tv') && !('ontouchstart' in window)) return true;
  // No fine pointer (no mouse) on large screen = TV/set-top box
  if (window.innerWidth >= 1280 && !window.matchMedia('(pointer: fine)').matches) return true;
  return false;
}

// ── DOM-based spatial navigation ─────────────────────────
function getVisible(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= window.innerHeight || r.left >= window.innerWidth) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  });
}

function spatialNavigate(dir: NavDir): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const all = getVisible();
  if (!all.length) return null;

  if (!active || !all.includes(active)) {
    return all[0];
  }

  const ar  = active.getBoundingClientRect();
  const acx = ar.left + ar.width  / 2;
  const acy = ar.top  + ar.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of all) {
    if (el === active) continue;
    const er  = el.getBoundingClientRect();
    const ecx = er.left + er.width  / 2;
    const ecy = er.top  + er.height / 2;
    const dx  = ecx - acx;
    const dy  = ecy - acy;

    // Must be meaningfully in the pressed direction
    const THRESHOLD = 8;
    const inDir =
      dir === 'right' ? dx >  THRESHOLD :
      dir === 'left'  ? dx < -THRESHOLD :
      dir === 'down'  ? dy >  THRESHOLD :
      dy < -THRESHOLD;
    if (!inDir) continue;

    // Primary distance (in travel direction) + lateral penalty (prefer aligned elements)
    const primary   = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
    const secondary = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 3;

    if (score < bestScore) { bestScore = score; best = el; }
  }

  return best;
}

// ── Component ─────────────────────────────────────────────
export function TVKeyboardHandler() {
  useEffect(() => {
    // Tag the document so CSS and components can adapt
    if (detectTV()) {
      document.documentElement.classList.add('tv-mode');
    }

    // Activate tv-mode on first arrow-key press when no fine pointer is available
    // (catches TVs with non-standard UA strings, e.g. budget Android TV boxes)
    const onFirstNav = (e: KeyboardEvent) => {
      if (document.documentElement.classList.contains('tv-mode')) {
        window.removeEventListener('keydown', onFirstNav, true);
        return;
      }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) &&
          !window.matchMedia('(pointer: fine)').matches) {
        document.documentElement.classList.add('tv-mode');
        window.removeEventListener('keydown', onFirstNav, true);
      }
    };
    window.addEventListener('keydown', onFirstNav, true);

    const handle = (e: KeyboardEvent) => {
      const key  = e.key;
      const code = (e as KeyboardEvent & { keyCode: number }).keyCode ?? 0;

      // ── Back (WebOS 461 / Tizen 10009 / BrowserBack 166) ──────
      if (BACK_KEYS.has(key) || BACK_CODES.has(code)) {
        // Dispatch app-level back event; don't prevent default so Escape still
        // closes native browser dialogs/popovers
        document.dispatchEvent(new CustomEvent('tv:back', { bubbles: false }));
        return;
      }

      // ── Escape also maps to Back ───────────────────────────────
      if (key === 'Escape') {
        document.dispatchEvent(new CustomEvent('tv:back', { bubbles: false }));
        // fall through — let Escape propagate normally for React modal handling
        return;
      }

      // ── Media keys (Play/Pause/Stop/FF/RW) ────────────────────
      if (MEDIA_KEYS.has(key) || MEDIA_CODES.has(code)) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('tv:media', {
          detail: { key, code }, bubbles: false,
        }));
        return;
      }

      // ── Arrow keys → spatial navigation ───────────────────────
      const dir: NavDir | null =
        key === 'ArrowUp'    || code === 38 ? 'up'    :
        key === 'ArrowDown'  || code === 40 ? 'down'  :
        key === 'ArrowLeft'  || code === 37 ? 'left'  :
        key === 'ArrowRight' || code === 39 ? 'right' : null;

      if (dir) {
        // Don't intercept arrows inside text inputs / textareas
        const active = document.activeElement as HTMLElement | null;
        const tag    = active?.tagName ?? '';
        if (tag === 'TEXTAREA') return;
        if (tag === 'INPUT') {
          const t = (active as HTMLInputElement).type;
          if (!['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(t)) return;
        }

        e.preventDefault();
        const next = spatialNavigate(dir);
        if (next) {
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }

      // ── Enter / OK on non-native elements ─────────────────────
      // Buttons/anchors handle Enter natively; divs/spans need a manual click.
      if (key === 'Enter' || code === 13) {
        const active = document.activeElement as HTMLElement | null;
        if (active) {
          const tag = active.tagName;
          if (!['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
            e.preventDefault();
            active.click();
          }
        }
      }
    };

    // Capture phase: runs before React synthetic handlers
    window.addEventListener('keydown', handle, true);
    return () => {
      window.removeEventListener('keydown', handle, true);
      window.removeEventListener('keydown', onFirstNav, true);
    };
  }, []);

  return null;
}
