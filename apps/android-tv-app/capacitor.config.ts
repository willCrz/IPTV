import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iptvpro.androidtv',
  appName: 'IPTV Pro',
  webDir: '../tv-web-app/out',
  android: {
    buildOptions: {
      keystorePath: process.env.KEYSTORE_PATH,
      keystoreAlias: process.env.KEYSTORE_ALIAS,
      keystorePassword: process.env.KEYSTORE_PASSWORD,
      keystoreAliasPassword: process.env.KEYSTORE_ALIAS_PASSWORD,
    },
  },
  server: {
    androidScheme: 'https',
    cleartext: true, // permite HTTP para streams IPTV
  },
  plugins: {
    SplashScreen: { launchShowDuration: 1000, backgroundColor: '#0a0a0f', showSpinner: false },
  },
};

export default config;
