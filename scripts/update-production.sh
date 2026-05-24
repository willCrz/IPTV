#!/bin/bash
# =============================================================
#  IPTV Pro — Atualizar produção (git pull + rebuild)
#  Uso: bash update-production.sh
# =============================================================
set -e

APP_DIR="$HOME/iptv-pro"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }

cd "$APP_DIR"

info "Buscando atualizações do repositório..."
git pull origin main

info "Reconstruindo containers com as novas versões..."
docker compose up -d --build

info "Aguardando serviços..."
sleep 15

docker compose ps

success "Atualização concluída!"
echo ""
echo "Para ver os logs: docker compose logs -f"
