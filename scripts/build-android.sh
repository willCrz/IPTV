#!/usr/bin/env bash
# ============================================================
# build-android.sh — Build IPTV Pro para Android TV / Google TV
#
# Uso:
#   chmod +x scripts/build-android.sh
#   ./scripts/build-android.sh [debug|release|aab]
#
# Pré-requisitos:
#   - Node.js 20+, pnpm
#   - Java 17+ (JAVA_HOME configurado)
#   - Android SDK (ANDROID_HOME configurado)
#   - Para release: keystore configurada via .env
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_APP="$ROOT/apps/android-tv-app"
TV_APP="$ROOT/apps/tv-web-app"
BUILD_TYPE="${1:-debug}"  # debug | release | aab

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${GREEN}[ANDROID]${NC} $1"; }
warn()    { echo -e "${YELLOW}[ANDROID]${NC} $1"; }
die()     { echo -e "${RED}[ANDROID ERROR]${NC} $1"; exit 1; }
step()    { echo -e "\n${BLUE}══ $1 ══${NC}"; }

info "🚀 Build Android TV — tipo: $BUILD_TYPE"

# ── Carregar variáveis de ambiente ────────────────────────
[ -f "$ROOT/.env.local" ] && source "$ROOT/.env.local"
[ -f "$ROOT/.env" ]       && source "$ROOT/.env"

# ── Checar dependências ────────────────────────────────────
step "Verificando dependências"

command -v node >/dev/null 2>&1   || die "Node.js não encontrado. Instale: https://nodejs.org"
command -v pnpm >/dev/null 2>&1   || die "pnpm não encontrado: npm i -g pnpm"
command -v java >/dev/null 2>&1   || die "Java não encontrado. Instale Java 17+"

JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
[ "${JAVA_VER:-0}" -ge 17 ] || die "Java 17+ necessário (encontrado: Java $JAVA_VER)"

[ -n "${ANDROID_HOME:-}" ] || die "ANDROID_HOME não definido. Configure o Android SDK."
[ -d "$ANDROID_HOME" ]     || die "ANDROID_HOME inválido: $ANDROID_HOME"

info "✅ Node $(node --version), Java $JAVA_VER, Android SDK: $ANDROID_HOME"

# ── Instalar dependências pnpm ─────────────────────────────
step "Instalando dependências"
cd "$ROOT"
pnpm install --frozen-lockfile
info "✅ Dependências instaladas"

# ── Build Next.js (static export) ─────────────────────────
step "Compilando app web (Android TV)"
cd "$TV_APP"
export NEXT_PUBLIC_PLATFORM=androidtv
export NODE_ENV=production
pnpm run build:androidtv

OUT_WEB="$TV_APP/out"
[ -d "$OUT_WEB" ] || die "Build falhou — pasta 'out' não encontrada"
info "✅ Web app compilado: $(du -sh "$OUT_WEB" | cut -f1)"

# ── Sincronizar com Capacitor ──────────────────────────────
step "Sincronizando com Capacitor"
cd "$ANDROID_APP"
pnpm exec cap sync android
info "✅ Capacitor sincronizado"

# ── Configurar keystore para release ──────────────────────
GRADLE_DIR="$ANDROID_APP/android"

if [ "$BUILD_TYPE" = "release" ] || [ "$BUILD_TYPE" = "aab" ]; then
  step "Configurando keystore para release"

  # Verificar variáveis de keystore
  : "${KEYSTORE_PATH:?KEYSTORE_PATH não definido em .env}"
  : "${KEYSTORE_ALIAS:?KEYSTORE_ALIAS não definido em .env}"
  : "${KEYSTORE_PASSWORD:?KEYSTORE_PASSWORD não definido em .env}"

  # Criar keystore.properties para Gradle
  cat > "$GRADLE_DIR/keystore.properties" << EOF
storeFile=$KEYSTORE_PATH
storePassword=$KEYSTORE_PASSWORD
keyAlias=$KEYSTORE_ALIAS
keyPassword=${KEYSTORE_ALIAS_PASSWORD:-$KEYSTORE_PASSWORD}
EOF
  info "✅ Keystore configurada"
else
  warn "Build DEBUG — sem assinatura de produção"
fi

# ── Compilar APK / AAB ────────────────────────────────────
step "Compilando com Gradle ($BUILD_TYPE)"
cd "$GRADLE_DIR"

# Garantir gradlew executável
chmod +x ./gradlew

case "$BUILD_TYPE" in
  debug)
    ./gradlew assembleDebug --no-daemon --stacktrace
    APK_PATH="$GRADLE_DIR/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  release)
    ./gradlew assembleRelease --no-daemon --stacktrace
    APK_PATH="$GRADLE_DIR/app/build/outputs/apk/release/app-release.apk"
    ;;
  aab)
    ./gradlew bundleRelease --no-daemon --stacktrace
    APK_PATH="$GRADLE_DIR/app/build/outputs/bundle/release/app-release.aab"
    ;;
  *)
    die "Tipo inválido: $BUILD_TYPE. Use: debug | release | aab"
    ;;
esac

[ -f "$APK_PATH" ] || die "Build Gradle falhou — arquivo não gerado em: $APK_PATH"

# ── Copiar para dist/ ─────────────────────────────────────
DIST_DIR="$ROOT/dist"
mkdir -p "$DIST_DIR"
DEST_FILE="$DIST_DIR/iptv-pro-androidtv-${BUILD_TYPE}.${APK_PATH##*.}"
cp "$APK_PATH" "$DEST_FILE"
info "✅ Arquivo final: $DEST_FILE ($(du -sh "$DEST_FILE" | cut -f1))"

# ── Instalar no dispositivo (opcional) ───────────────────
if [ "${INSTALL:-0}" = "1" ]; then
  step "Instalando no dispositivo"
  command -v adb >/dev/null 2>&1 || die "adb não encontrado. Adicione platform-tools ao PATH"

  DEVICES=$(adb devices | grep -v "List" | grep "device$" | wc -l)
  [ "$DEVICES" -gt 0 ] || die "Nenhum dispositivo Android conectado. Conecte via USB ou ADB WiFi."

  info "📲 Instalando APK..."
  adb install -r "$DEST_FILE"
  info "▶  Iniciando app..."
  adb shell am start -n "com.iptvpro.androidtv/.MainActivity"
  info "✅ App instalado e iniciado!"
fi

# ── Resumo ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ ANDROID TV BUILD CONCLUÍDO"
echo "  📦 Arquivo: $DEST_FILE"
echo "═══════════════════════════════════════════════"
echo ""
echo "  INSTALAÇÃO NO ANDROID TV / GOOGLE TV:"
echo ""
echo "  Opção 1 — ADB (recomendado para desenvolvimento):"
echo "    1. Ative 'Depuração USB' em Configurações → Sobre → Build"
echo "    2. Conecte: adb connect SEU_IP_DA_TV:5555"
echo "    3. Instale: adb install -r $DEST_FILE"
echo ""
echo "  Opção 2 — USB direto:"
echo "    1. Copie o APK para um USB FAT32"
echo "    2. Use um gerenciador de arquivos na TV (ex: FX File Explorer)"
echo "    3. Abra o APK para instalar"
echo ""
echo "  Opção 3 — Sideload via WiFi:"
echo "    INSTALL=1 ./scripts/build-android.sh debug"
echo ""
echo "  Para release na Play Store:"
echo "    ./scripts/build-android.sh aab"
echo "    (upload o .aab no Google Play Console)"
echo ""
