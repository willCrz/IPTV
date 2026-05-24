#!/bin/bash
# =============================================================
#  IPTV Pro — Setup completo para Oracle Cloud Free Tier
#  Testado em: Ubuntu 22.04 LTS (ARM / x86)
#  Uso: bash setup-oracle-server.sh
# =============================================================
set -e

REPO_URL="https://github.com/willCrz/IPTV.git"
APP_DIR="$HOME/iptv-pro"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }

echo ""
echo "======================================================"
echo "  IPTV Pro — Deploy automático Oracle Cloud Free Tier"
echo "======================================================"
echo ""

# ── 1. Detectar IP público ──────────────────────────────────
info "Detectando IP público do servidor..."
PUBLIC_IP=$(curl -s --max-time 5 http://checkip.amazonaws.com || \
            curl -s --max-time 5 https://api.ipify.org || \
            hostname -I | awk '{print $1}')
success "IP público: $PUBLIC_IP"

# ── 2. Atualizar sistema ────────────────────────────────────
info "Atualizando pacotes do sistema..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git openssl ca-certificates gnupg lsb-release apt-transport-https
success "Pacotes base instalados."

# ── 3. Instalar Docker ──────────────────────────────────────
if ! command -v docker &> /dev/null; then
  info "Instalando Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  success "Docker instalado."
else
  success "Docker já instalado: $(docker --version)"
fi

# ── 4. Instalar Docker Compose plugin ──────────────────────
if ! docker compose version &> /dev/null 2>&1; then
  info "Instalando Docker Compose plugin..."
  sudo apt-get install -y -qq docker-compose-plugin
  success "Docker Compose instalado."
else
  success "Docker Compose já instalado: $(docker compose version --short)"
fi

# ── 5. Abrir portas no firewall do SO ──────────────────────
info "Configurando firewall (portas 80 e 443)..."
if command -v ufw &> /dev/null; then
  sudo ufw allow 80/tcp   > /dev/null 2>&1 || true
  sudo ufw allow 443/tcp  > /dev/null 2>&1 || true
  sudo ufw allow 22/tcp   > /dev/null 2>&1 || true
  sudo ufw --force enable > /dev/null 2>&1 || true
else
  sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
  # Persistir regras no Oracle Linux / Ubuntu
  if command -v netfilter-persistent &> /dev/null; then
    sudo netfilter-persistent save 2>/dev/null || true
  elif command -v iptables-save &> /dev/null; then
    sudo iptables-save | sudo tee /etc/iptables/rules.v4 > /dev/null 2>&1 || true
  fi
fi
success "Firewall configurado."

# ── 6. Clonar repositório ───────────────────────────────────
if [ -d "$APP_DIR" ]; then
  warn "Diretório $APP_DIR já existe. Fazendo git pull..."
  cd "$APP_DIR" && git pull origin main
else
  info "Clonando repositório..."
  git clone "$REPO_URL" "$APP_DIR"
  success "Repositório clonado em $APP_DIR"
fi
cd "$APP_DIR"

# ── 7. Gerar credenciais seguras ────────────────────────────
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

# ── 8. Criar arquivo .env de produção ──────────────────────
info "Criando arquivo .env de produção..."
cat > .env <<EOF
# Gerado automaticamente por setup-oracle-server.sh
NODE_ENV=production

# App
NEXT_PUBLIC_APP_NAME="IPTV Pro"
NEXT_PUBLIC_APP_VERSION="1.0.0"
NEXT_PUBLIC_PLATFORM=web

# API — usa o IP público do servidor
NEXT_PUBLIC_API_URL=http://${PUBLIC_IP}/api
NEXT_PUBLIC_WS_URL=ws://${PUBLIC_IP}/api

# PostgreSQL
DB_HOST=postgres
DB_PORT=5432
DB_NAME=iptv_pro
DB_USER=iptv_user
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://iptv_user:${DB_PASSWORD}@postgres:5432/iptv_pro

# Redis
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_TTL=3600

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# CORS — permite acesso pelo IP e pelo domínio (se tiver)
CORS_ORIGIN=http://${PUBLIC_IP},http://${PUBLIC_IP}:3000

# Rate limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# Health / Stream
HEALTH_CHECK_INTERVAL=30000
STREAM_TIMEOUT=10000
PING_TIMEOUT=5000

# Sentry (opcional — deixe vazio para desativar)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
EOF
success ".env criado com credenciais geradas automaticamente."

# ── 9. Garantir diretório nginx/ssl ────────────────────────
mkdir -p nginx/ssl

# ── 10. Build e start de todos os containers ───────────────
info "Fazendo build e iniciando todos os serviços (pode demorar 5-10 min)..."
# Garante que o grupo docker está ativo nesta sessão
if groups "$USER" | grep -q docker; then
  docker compose up -d --build
else
  sudo docker compose up -d --build
fi
success "Containers iniciados."

# ── 11. Aguardar serviços ficarem healthy ───────────────────
info "Aguardando serviços ficarem healthy (até 3 minutos)..."
TIMEOUT=180
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  UNHEALTHY=$(docker compose ps --format json 2>/dev/null | \
    python3 -c "import sys,json; [print(s['Name']) for s in json.load(sys.stdin) if s.get('Health','') not in ('healthy','')]" \
    2>/dev/null || echo "")
  ALL_UP=$(docker compose ps --format json 2>/dev/null | \
    python3 -c "import sys,json; services=json.load(sys.stdin); print('ok' if all(s.get('State','') == 'running' for s in services) else 'wait')" \
    2>/dev/null || echo "wait")
  if [ "$ALL_UP" = "ok" ]; then
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo -n "."
done
echo ""

# ── 12. Status final ────────────────────────────────────────
echo ""
echo "======================================================"
echo ""
docker compose ps
echo ""
echo "======================================================"
success "Deploy concluído!"
echo ""
echo -e "${GREEN}Acesse o sistema em:${NC}"
echo -e "  ${CYAN}http://${PUBLIC_IP}${NC}         (frontend via nginx)"
echo -e "  ${CYAN}http://${PUBLIC_IP}/api/v1/health${NC}  (health check da API)"
echo ""
echo -e "${YELLOW}IMPORTANTE — Anote estas credenciais geradas:${NC}"
echo -e "  JWT_SECRET  : ${JWT_SECRET}"
echo -e "  DB_PASSWORD : ${DB_PASSWORD}"
echo ""
echo -e "${YELLOW}Guarde o arquivo .env:${NC}"
echo -e "  cat $APP_DIR/.env"
echo ""
echo "Para acompanhar os logs:"
echo "  docker compose -f $APP_DIR/docker-compose.yml logs -f"
echo ""
