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
      <body suppressHydrationWarning>
        <TVKeyboardHandler />
        {children}
      </body>
    </html>
  );
}
