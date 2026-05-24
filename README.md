# IPTV Pro 📺

Player IPTV profissional multi-plataforma. Suporte completo a Titan OS, LG webOS, Android TV, Google TV, Browser e Mobile.

## Plataformas suportadas

| Plataforma | Status | Build |
|---|---|---|
| 🌐 Navegador Desktop | ✅ | `pnpm dev` |
| 📱 Mobile | ✅ | `pnpm dev` |
| 📺 Titan OS | ✅ | `./scripts/build-titan.sh` |
| 📺 LG webOS | ✅ | `./scripts/build-webos.sh` |
| 📺 Android TV / Google TV | ✅ | `./scripts/build-android.sh` |
| 📺 Samsung Tizen | 🔜 | estrutura preparada |

## Stack

**Frontend:** Next.js 15 · React · TypeScript · TailwindCSS · Zustand · TanStack Query · HLS.js  
**Backend:** Fastify · Node.js · Redis · PostgreSQL · Docker  
**TV:** Capacitor (Android TV) · ares-cli (webOS) · static export (Titan OS)

---

## Pré-requisitos

- [Node.js 20+](https://nodejs.org)
- [pnpm 9+](https://pnpm.io) — `npm i -g pnpm`
- [Docker + Docker Compose](https://docker.com) (para o backend)

---

## Instalação rápida (desenvolvimento)

```bash
# 1. Clonar
git clone https://github.com/seu-usuario/iptv-pro.git
cd iptv-pro

# 2. Instalar dependências (todos os packages)
pnpm install

# 3. Configurar variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com suas configurações

# 4. Subir backend (PostgreSQL + Redis + APIs)
docker compose up -d postgres redis api-gateway health-service stream-service

# 5. Rodar app em desenvolvimento
pnpm dev
# Acesse: http://localhost:3000
```

---

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e configure:

| Variável | Descrição | Padrão |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | URL do backend | `http://localhost:3001` |
| `NEXT_PUBLIC_PLATFORM` | Plataforma alvo | `web` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Chave JWT (256 bits) | — |
| `KEYSTORE_PATH` | Caminho do keystore Android | — |

---

## Build para cada plataforma

### 🌐 Navegador / Servidor

```bash
pnpm build:tv
# Gera: apps/tv-web-app/.next/
```

### 📺 Titan OS

```bash
chmod +x scripts/build-titan.sh
./scripts/build-titan.sh
# Gera: dist/titan/ + dist/iptv-pro-titan.zip
```

**Instalação:**
1. Copie o ZIP para um USB FAT32
2. Na TV Titan: *Menu → Apps → Instalar → USB*
3. Ou ative o Developer Mode e faça upload via `http://TV_IP:9998`

### 📺 LG webOS

```bash
# Instalar CLI da LG (uma vez só)
npm i -g @webosose/ares-cli

chmod +x scripts/build-webos.sh
./scripts/build-webos.sh
# Gera: dist/com.iptvpro.webosapp_1.0.0_all.ipk
```

**Instalação:**
```bash
# 1. Ativar Developer Mode na TV:
#    Configurações → General → Devices → TV Management → Developer Mode: ON

# 2. Adicionar TV ao ares-cli:
ares-setup-device
# (siga o wizard, informe o IP da TV)

# 3. Instalar e lançar:
ares-install --device tv dist/com.iptvpro.webosapp_*.ipk
ares-launch --device tv com.iptvpro.webosapp

# Ou tudo em um comando:
DEPLOY=1 TV_DEVICE=tv ./scripts/build-webos.sh
```

### 📺 Android TV / Google TV

**Pré-requisitos extras:**
- [Java 17+](https://adoptium.net)
- [Android Studio](https://developer.android.com/studio) ou Android SDK via CLI
- `ANDROID_HOME` configurado no ambiente

```bash
chmod +x scripts/build-android.sh

# Build debug (para testes)
./scripts/build-android.sh debug
# Gera: dist/iptv-pro-androidtv-debug.apk

# Build release (produção)
./scripts/build-android.sh release
# Gera: dist/iptv-pro-androidtv-release.apk

# Build AAB (Google Play Store)
./scripts/build-android.sh aab
# Gera: dist/iptv-pro-androidtv-release.aab
```

**Instalação via ADB:**
```bash
# Conectar TV via WiFi
adb connect IP_DA_TV:5555

# Instalar
adb install -r dist/iptv-pro-androidtv-debug.apk

# Ou instalar automaticamente após o build:
INSTALL=1 ./scripts/build-android.sh debug
```

**Instalação via USB:**
1. Copie o `.apk` para um USB FAT32
2. Instale um gerenciador de arquivos na TV (ex: FX File Explorer via Play Store)
3. Abra o `.apk` pelo gerenciador

**Para assinatura de release**, adicione ao `.env.local`:
```env
KEYSTORE_PATH=/caminho/para/minha.keystore
KEYSTORE_ALIAS=minha-chave
KEYSTORE_PASSWORD=minha-senha
KEYSTORE_ALIAS_PASSWORD=minha-senha-alias
```

---

## Estrutura do projeto

```
iptv-pro/
├── apps/
│   ├── tv-web-app/          # App principal (Next.js 15)
│   ├── android-tv-app/      # Wrapper Capacitor (Android TV)
│   └── admin-panel/         # Painel administrativo
├── packages/
│   ├── shared-types/        # Tipos TypeScript compartilhados
│   ├── player-core/         # Engine do player (HLS, retry, M3U, Xtream)
│   ├── ui-core/             # FocusManager, PlatformDetector
│   ├── stream-monitor/      # Monitoramento de bitrate/qualidade
│   └── cache-engine/        # Cache hierárquico (Memory→IDB→localStorage)
├── backend/
│   ├── api-gateway/         # Fastify API principal
│   ├── health-service/      # Monitoramento de servidores
│   └── stream-service/      # Análise de streams
├── scripts/
│   ├── build-titan.sh       # Build + empacotamento Titan OS
│   ├── build-webos.sh       # Build + .ipk para webOS
│   └── build-android.sh     # Build + APK/AAB Android TV
└── docker-compose.yml       # Stack completa
```

---

## Uso rápido

1. **Abra** o app em `http://localhost:3000`
2. **Conecte** sua lista via *Xtream Codes* ou *M3U*
3. **Navegue** com mouse, toque ou controle remoto (D-pad)
4. **Assista** — zapping rápido, fallback automático, sem travamentos

---

## Deploy em produção

```bash
# Build e subir stack completa
docker compose up -d --build

# Verificar status
docker compose ps
docker compose logs -f api-gateway

# Health check
curl http://localhost/health
```

---

## Comandos úteis

```bash
pnpm dev              # Desenvolvimento (todos os apps em paralelo)
pnpm build            # Build de produção
pnpm lint             # Lint em todo o monorepo
pnpm type-check       # Verificação TypeScript
docker compose up -d  # Subir backend completo
docker compose logs   # Ver logs dos containers
```

---

## Licença

MIT — use, modifique e distribua livremente.
