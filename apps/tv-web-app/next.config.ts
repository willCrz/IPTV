import type { NextConfig } from 'next';

const platform = process.env.NEXT_PUBLIC_PLATFORM ?? 'web';
const isTV = ['titan', 'webos', 'tizen', 'androidtv', 'googletv'].includes(platform);

const config: NextConfig = {
  output: isTV ? 'export' : 'standalone',
  trailingSlash: isTV,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'http', hostname: '**' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    if (isTV) return [];
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
  webpack: (webpackConfig, { isServer }) => {
    if (!isServer) {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false, net: false, tls: false,
      };
    }
    return webpackConfig;
  },
};

export default config;
