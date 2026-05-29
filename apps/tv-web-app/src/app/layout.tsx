import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TVKeyboardHandler } from '@/components/layout/TVKeyboardHandler';

export const metadata: Metadata = {
  title: 'Optmus+',
  description: 'Player IPTV profissional multi-plataforma',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0B0F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Non-blocking font load — preconnect avoids DNS/TLS overhead */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300;0,400;0,500;0,600;0,700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <TVKeyboardHandler />
        {children}
      </body>
    </html>
  );
}
