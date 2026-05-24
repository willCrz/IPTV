import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iptvpro.app',
  appName: 'IPTV Pro',
  webDir: 'out',
  server: {
    // Em desenvolvimento: apontar para o servidor local
    // Em produção: comentar esta linha (usa os arquivos em /out)
    // url: 'http://192.168.1.100:3000',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      keystorePath: 'android/app/iptv-pro.keystore',
      keystoreAlias: 'iptv-pro',
    },
    backgroundColor: '#0a0a0f',
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0f',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
