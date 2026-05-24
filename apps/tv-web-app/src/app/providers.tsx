"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { PlatformDetector } from "@iptv/ui-core";
import { FocusManager } from "@iptv/ui-core";
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 300000, retry: 2, refetchOnWindowFocus: false } } });
}
let client: QueryClient | undefined;
function getClient() { if (typeof window === "undefined") return makeQueryClient(); if (!client) client = makeQueryClient(); return client; }
export function Providers({ children }: { children: React.ReactNode }) {
  const qc = getClient();
  const init = useRef(false);
  useEffect(() => {
    if (init.current) return; init.current = true;
    const p = PlatformDetector.detect();
    document.documentElement.dataset.platform = p;
    if (PlatformDetector.isTVPlatform()) { document.documentElement.classList.add("tv-mode"); FocusManager.getInstance().enable(); }
    if (!PlatformDetector.supportsAnimations()) document.documentElement.classList.add("reduce-motion");
  }, []);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
