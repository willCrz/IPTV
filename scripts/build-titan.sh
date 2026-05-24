#!/usr/bin/env bash
# ============================================================
# build-titan.sh — Build IPTV Pro para Titan OS (HTML5 Hosted App)
#
# Uso:
#   chmod +x scripts/build-titan.sh
#   ./scripts/build-titan.sh
#
# Pré-requisitos:
#   - Node.js 20+ e pnpm instalados
#   - Acesso à pasta do projeto
# ============================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist/titan"
APP_DIR="$ROOT/apps/tv-web-app"

# Cores
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[TITAN]${NC} $1"; }
warn()    { echo -e "${YELLOW}[TITAN]${NC} $1"; }
die()     { echo -e "${RED}[TITAN ERROR]${NC} $1"; exit 1; }

info "🚀 Iniciando build para Titan OS..."

# ── 1. Checar dependências ─────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js não encontrado. Instale: https://nodejs.org"
command -v pnpm >/dev/null 2>&1 || die "pnpm não encontrado. Instale: npm i -g pnpm"

NODE_VER=$(node --version | tr -d 'v' | cut -d. -f1)
[ "$NODE_VER" -ge 18 ] || die "Node.js 18+ necessário (encontrado: $NODE_VER)"

# ── 2. Instalar dependências ───────────────────────────────
info "📦 Instalando dependências..."
cd "$ROOT"
pnpm install --frozen-lockfile

# ── 3. Build Next.js com output: export ───────────────────
info "🔨 Compilando app (static export para Titan OS)..."
cd "$APP_DIR"

export NEXT_PUBLIC_PLATFORM=titan
export NODE_ENV=production

pnpm run build:titan

OUT_WEB="$APP_DIR/out"
[ -d "$OUT_WEB" ] || die "Build falhou — pasta 'out' não encontrada"

info "✅ Build Next.js concluído: $(du -sh "$OUT_WEB" | cut -f1)"

# ── 4. Criar estrutura do app Titan ───────────────────────
info "📁 Criando pacote Titan OS..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Copiar arquivos buildados
cp -r "$OUT_WEB/." "$OUT_DIR/"

# Criar appinfo.json (metadados obrigatórios para Titan OS)
cat > "$OUT_DIR/appinfo.json" << 'APPINFO'
{
  "id": "com.iptvpro.titanapp",
  "version": "1.0.0",
  "vendor": "IPTV Pro",
  "type": "web",
  "main": "index.html",
  "title": "IPTV Pro",
  "icon": "icon.png",
  "largeIcon": "icon_large.png",
  "splashBackground": "#0a0a0f",
  "transparent": false,
  "usePrerendering": false,
  "handlesRelaunch": true,
  "noSplashOnLaunch": false
}
APPINFO

# Gerar ícones placeholder (substituir pelos reais)
if ! [ -f "$APP_DIR/public/icon.png" ]; then
  warn "⚠  icon.png não encontrado em public/ — usando placeholder"
  # Cria um PNG mínimo válido de 80x80 (base64)
  echo "iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVRoge3BMQEAAADCoPVP7WsIoAAAeAMBxAABJRU5ErkJggg==" | base64 -d > "$OUT_DIR/icon.png"
fi

# ── 5. Compactar em .ipk ──────────────────────────────────
if command -v ares-package >/dev/null 2>&1; then
  info "📦 Gerando .ipk com ares-package..."
  ares-package "$OUT_DIR" -o "$ROOT/dist"
  IPK_FILE=$(ls "$ROOT/dist/"*.ipk 2>/dev/null | head -1)
  [ -n "$IPK_FILE" ] && info "✅ IPK gerado: $IPK_FILE" || warn "IPK não gerado — instale manualmente via pasta"
else
  warn "ares-package não encontrado — gerando .zip para instalação manual"
  ZIP_FILE="$ROOT/dist/iptv-pro-titan.zip"
  cd "$OUT_DIR"
  zip -r "$ZIP_FILE" . -q
  info "✅ ZIP gerado: $ZIP_FILE"
fi

# ── 6. Resumo ─────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ TITAN OS BUILD CONCLUÍDO"
echo "  📂 Arquivos: $OUT_DIR"
echo "═══════════════════════════════════════════════"
echo ""
echo "  INSTALAÇÃO NO TITAN OS:"
echo ""
echo "  Opção 1 — IPK (recomendado):"
echo "    1. Copie o .ipk para um USB FAT32"
echo "    2. Na TV: Menu → Apps → Instalar → USB"
echo ""
echo "  Opção 2 — Servidor local:"
echo "    1. Execute: npx serve $OUT_DIR -p 8080"
echo "    2. Na TV: Menu → Navegador → http://SEU_IP:8080"
echo ""
echo "  Opção 3 — Zip via Developer Mode:"
echo "    1. Ative o Developer Mode nas configurações da TV"
echo "    2. Acesse http://TV_IP:9998 no navegador do PC"
echo "    3. Faça upload do .zip"
echo ""
