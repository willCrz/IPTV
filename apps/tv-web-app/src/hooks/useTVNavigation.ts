'use client';
import { useEffect, useRef } from 'react';

export interface TVNavigationOptions {
  enabled?: boolean;
  onBack?: () => void;
  onEnter?: () => void;
  // Legacy channel-up/down (still supported for components that use them)
  onChannelUp?: () => void;
  onChannelDown?: () => void;
  onColorBlue?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
}

/**
 * Hook for page/component-level remote control callbacks.
 *
 * Listens for the `tv:back` and `tv:media` custom events dispatched by
 * TVKeyboardHandler (which runs globally in the layout). Also provides
 * legacy onChannelUp/Down support for screens that need it.
 *
 * Spatial navigation (arrow keys) is handled globally by TVKeyboardHandler
 * and does NOT need to be wired here.
 */
export function useTVNavigation(opts: TVNavigationOptions = {}) {
  // Use a ref so callbacks are always current without re-subscribing
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Listen for tv:back custom event from TVKeyboardHandler
  useEffect(() => {
    const onBack = () => optsRef.current.onBack?.();
    document.addEventListener('tv:back', onBack);
    return () => document.removeEventListener('tv:back', onBack);
  }, []);

  // Legacy: direct keydown for channel up/down (some screens need immediate response)
  useEffect(() => {
    if (!opts.onChannelUp && !opts.onChannelDown) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); optsRef.current.onChannelUp?.();   }
      if (e.key === 'ArrowDown') { e.preventDefault(); optsRef.current.onChannelDown?.(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!opts.onChannelUp, !!opts.onChannelDown]);
}
