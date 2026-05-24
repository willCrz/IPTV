#!/usr/bin/env bash
# ============================================================
# build-webos.sh — Build IPTV Pro para LG webOS
#
# Uso:
#   chmod +x scripts/build-webos.sh
#   ./scripts/build-webos.sh
#
# Pré-requisitos:
#   - Node.js 20+ e pnpm
#   - ares-cli (CLI oficial da LG): npm i -g @webosose/ares-cli
#   - Para instalar na TV: TV em Developer Mode + ares-setup-device
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist/webos"
APP_DIR="$ROOT/apps/tv-web-app"
APP_ID="com.iptvpro.webosapp"
APP_VERSION="1.0.0"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[WEBOS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WEBOS]${NC} $1"; }
die()  { echo -e "${RED}[WEBOS ERROR]${NC} $1"; exit 1; }

info "🚀 Iniciando build para LG webOS..."

# ── Checar dependências ────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js não encontrado"
command -v pnpm >/dev/null 2>&1 || die "pnpm não encontrado"

if ! command -v ares-package >/dev/null 2>&1; then
  warn "ares-cli não encontrado. Instalando globalmente..."
  npm install -g @webosose/ares-cli
fi

# ── Build Next.js ──────────────────────────────────────────
info "🔨 Compilando app (static export para webOS)..."
cd "$ROOT"
pnpm install --frozen-lockfile

cd "$APP_DIR"
export NEXT_PUBLIC_PLATFORM=webos
export NODE_ENV=production
pnpm run build:webos

OUT_WEB="$APP_DIR/out"
[ -d "$OUT_WEB" ] || die "Build falhou — pasta 'out' não encontrada"
info "✅ Build concluído"

# ── Criar estrutura webOS ──────────────────────────────────
info "📁 Criando pacote webOS..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$OUT_WEB/." "$OUT_DIR/"

# appinfo.json — metadados obrigatórios para webOS
cat > "$OUT_DIR/appinfo.json" << APPINFO
{
  "id": "$APP_ID",
  "version": "$APP_VERSION",
  "vendor": "IPTV Pro",
  "type": "web",
  "main": "index.html",
  "title": "IPTV Pro",
  "icon": "icon.png",
  "largeIcon": "icon_large.png",
  "iconColor": "#0a0a0f",
  "splashBackground": "#0a0a0f",
  "requiredPermissions": ["audio.operation","media.operation","externalStorage.read"],
  "resolution": "1920x1080",
  "transparent": false,
  "tileSize": "normal",
  "noWindow": false,
  "uiRevision": "2",
  "disableBackHistoryAPI": false,
  "enableKeyboard": false
}
APPINFO

# Ícone placeholder se não existir
[ -f "$APP_DIR/public/icon.png" ] && cp "$APP_DIR/public/icon.png" "$OUT_DIR/icon.png" || \
  echo "iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVRoge3BMQEAAADCoPVP7WsIoAAAeAMBxAABJRU5ErkJggg==" | base64 -d > "$OUT_DIR/icon.png"

# ── Empacotar em .ipk ─────────────────────────────────────
info "📦 Gerando pacote .ipk..."
DIST_DIR="$ROOT/dist"
mkdir -p "$DIST_DIR"
ares-package "$OUT_DIR" -o "$DIST_DIR" --no-minify

IPK_FILE=$(ls "$DIST_DIR/${APP_ID}_"*.ipk 2>/dev/null | head -1)
[ -n "$IPK_FILE" ] || die "Falha ao gerar .ipk"
info "✅ IPK gerado: $IPK_FILE ($(du -sh "$IPK_FILE" | cut -f1))"

# ── Deploy opcional ────────────────────────────────────────
if [ "${DEPLOY:-0}" = "1" ]; then
  TV_DEVICE="${TV_DEVICE:-tv}"
  info "📡 Instalando na TV ($TV_DEVICE)..."
  ares-install --device "$TV_DEVICE" "$IPK_FILE"
  info "▶  Iniciando app..."
  ares-launch --device "$TV_DEVICE" "$APP_ID"
  info "✅ App instalado e iniciado!"
fi

# ── Resumo ─────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ WEBOS BUILD CONCLUÍDO"
echo "  📦 IPK: $IPK_FILE"
echo "═══════════════════════════════════════════════"
echo ""
echo "  INSTALAÇÃO NA LG TV:"
echo ""
echo "  Passo 1 — Ativar Developer Mode na TV:"
echo "    Settings → General → Devices → TV Management"
echo "    → Developer Mode: ON"
echo ""
echo "  Passo 2 — Adicionar dispositivo:"
echo "    ares-setup-device"
echo "    (siga o wizard, informe IP da TV)"
echo ""
echo "  Passo 3 — Instalar e lançar:"
echo "    ares-install --device tv $IPK_FILE"
echo "    ares-launch --device tv $APP_ID"
echo ""
echo "  Ou instale tudo de uma vez:"
echo "    DEPLOY=1 TV_DEVICE=tv ./scripts/build-webos.sh"
echo ""
