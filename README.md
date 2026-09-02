# Vycord

Discord-like application with voice/video calls, group chats, and AI-powered noise cancellation (DeepFilterNet).

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Electron + React + TypeScript + Vite |
| **Backend** | Go (Golang) |
| **Database** | PostgreSQL |
| **Cache** | Redis |
| **Real-time** | WebSocket (gorilla/websocket) |
| **Voice/Video** | WebRTC (pion/webrtc) — TODO |
| **Noise Cancellation** | DeepFilterNet — TODO |

## Project Structure

```
vycord/
├── server/                     # Go backend (Clean Architecture)
│   ├── cmd/api/                # Application entry point
│   ├── internal/               # Private application code
│   │   ├── config/             # Configuration
│   │   ├── domain/             # Entities & interfaces
│   │   ├── usecase/            # Business logic
│   │   ├── repository/postgres/# Data access layer
│   │   └── delivery/http/      # HTTP handlers, WebSocket, middleware
│   ├── pkg/logger/             # Shared packages
│   ├── migrations/             # SQL migrations
│   ├── tests/                  # E2E tests
│   └── go.mod
├── client/                     # Electron + React + TypeScript
│   ├── electron/               # Electron main process
│   ├── src/
│   │   ├── types/              # TypeScript types
│   │   ├── stores/             # Zustand state stores
│   │   ├── services/           # API & WebSocket services
│   │   ├── pages/              # Page components
│   │   ├── components/         # UI components
│   │   ├── hooks/              # React hooks
│   │   └── App.tsx             # Root component
│   └── package.json
├── docker-compose.yml          # PostgreSQL + Redis
├── Makefile                    # Build & dev commands
└── README.md
```

## Getting Started

### Prerequisites
- Go 1.22+
- Docker & Docker Compose
- Node.js 20+

### 1. Start Infrastructure

```bash
make docker-up
```

### 2. Run Migrations

```bash
make install-migrate
make migrate-up
```

### 3. Start Backend

```bash
make run    # or: cd server && go run ./cmd/api
```

### 4. Start Frontend

```bash
cd client
npm run dev
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login and get JWT token |
| GET | `/api/v1/auth/me` | Get current user (requires Bearer token) |

### Users
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/users?q=search&limit=20` | Search users |
| GET | `/api/v1/users/{id}` | Get user by ID |

### Servers
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/servers` | Create server |
| GET | `/api/v1/servers` | Get user's servers |
| GET | `/api/v1/servers/{id}` | Get server details |
| POST | `/api/v1/servers/{id}/join` | Join server |
| POST | `/api/v1/servers/{id}/leave` | Leave server |

### Channels
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/servers/{server_id}/channels` | Create channel |
| GET | `/api/v1/servers/{server_id}/channels` | Get server channels |

### Messages
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/channels/{channel_id}/messages` | Create message |
| GET | `/api/v1/channels/{channel_id}/messages?limit=50&offset=0` | Get messages |

### WebSocket
```
GET /ws?token={jwt_token}
```

Message format:
```json
{"type": "chat_message", "payload": {...}}
{"type": "typing", "payload": {...}}
{"type": "ping", "payload": {}}
```

## Makefile Commands

```bash
make help              # Show all available commands
make docker-up         # Start PostgreSQL + Redis
make docker-down       # Stop infrastructure
make migrate-up        # Run database migrations
make run               # Start server
make build             # Build server binary
make test              # Run tests
make lint              # Run linter
make fmt               # Format code
make clean             # Remove build artifacts
```

## Architecture

### Backend (Clean Architecture)

```
┌─────────────────────────────────────────────────┐
│                  Delivery Layer                  │
│  (HTTP Handlers, WebSocket Handlers, Middleware) │
├─────────────────────────────────────────────────┤
│                  Use Case Layer                  │
│  (Business Logic, Validation, Orchestration)    │
├─────────────────────────────────────────────────┤
│                  Domain Layer                    │
│  (Entities, Repository Interfaces, Use Cases)   │
├─────────────────────────────────────────────────┤
│               Repository Layer                   │
│  (PostgreSQL, Redis, External Services)          │
└─────────────────────────────────────────────────┘
```

### Database Schema

```
users ──< servers ──< channels ──< messages
  │         │
  │         └──< server_members >── users
  │
  └──< messages
```

## Current Status

| Feature | Status |
|---|---|
| User registration & login | ✅ Done |
| JWT authentication | ✅ Done |
| Server creation & management | ✅ Done |
| Channel creation (text/voice) | ✅ Done |
| REST API for all resources | ✅ Done |
| WebSocket real-time chat | ✅ Done |
| Discord-like UI (dark theme) | ✅ Done |
| Login/Register pages | ✅ Done |
| Server list sidebar | ✅ Done |
| Channel sidebar | ✅ Done |
| Chat area with messages | ✅ Done |
| User list | ✅ Done |
| Electron frameless window | ✅ Done |
| System tray | ✅ Done |
| TypeScript type safety | ✅ Done |
| E2E tests | ✅ Done |
| | |
| WebRTC 1-1 calls | 🚧 TODO |
| WebRTC group calls (SFU) | 🚧 TODO |
| DeepFilterNet noise cancellation | ✅ Done |
| Screen sharing | 🚧 TODO |
| File uploads | 🚧 TODO |
| Windows 11 installer | 🚧 TODO |

## TURN (prod)

Голос и видео у клиентов за симметричным NAT или VPN работают только через
TURN-релей (coturn, поднимается в `docker-compose.prod.yml`). Креденшелы
ephemeral — их выдаёт API: `GET /api/v1/turn/credentials`.

### Порты (фаервол)

| Порт | Назначение |
|---|---|
| 3478/udp | TURN, основной транспорт |
| 3478/tcp | TURN по TCP — когда UDP заблокирован |
| 5349/tcp | TURN по TLS (`turns:`) — жёсткие фаерволы, где режется и plain-TCP |
| 49160–49360/udp | relay-диапазон |

```bash
sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49360/udp
```

### Проверка после деплоя

```bash
./deploy/check-turn.sh          # ждём OK по 3478/udp, 3478/tcp, 5349/tls
./deploy/check-turn.sh --print  # креды для ручной проверки
```

Скрипт гоняет проверку с самого сервера: он доказывает, что coturn, секрет и
TLS исправны, но **не** внешнюю доступность портов. Внешняя проверка: открыть
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
из другой сети, добавить `turns:api.vycord.webvaha.ru:5349?transport=tcp` с
кредами из `--print` и убедиться, что появляется кандидат типа `relay`.

### Сертификат

coturn использует Let's Encrypt-сертификат api-домена: certbot deploy-hook
(`deploy/coturn-cert-hook.sh`, устанавливается `deploy.sh`) копирует его в
`/var/lib/vycord/coturn-certs/` и рестартует контейнер при каждом продлении.
Продление рвёт активные relay-аллокации (~раз в 60 дней, ночью) — активный
звонок у relay-клиентов при этом падает, нужно перезайти в звонок
(авто-ICE-restart пока не реализован).

## Error reporting (GlitchTip, prod)

Клиентские ошибки (веб + Electron) репортятся в self-hosted
[GlitchTip](https://glitchtip.com/) — Sentry-протокол-совместимый трекер,
поднимается в `docker-compose.prod.yml` (`glitchtip-db-init`,
`glitchtip`), переиспользует существующие
Postgres/Redis.

### Первичная настройка (один раз)

1. DNS: A-запись `errors.vycord.webvaha.ru` → IP сервера.
2. Сертификат:
   ```bash
   sudo cp deploy/nginx/errors.vycord.webvaha.ru.conf /etc/nginx/sites-available/errors.vycord.webvaha.ru
   sudo ln -sf /etc/nginx/sites-available/errors.vycord.webvaha.ru /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d errors.vycord.webvaha.ru --non-interactive --agree-tos -m admin@webvaha.ru
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Заполнить в `.env.prod`: `GLITCHTIP_SECRET_KEY` (`openssl rand -hex 32`),
   `GLITCHTIP_DATABASE_URL`, `GLITCHTIP_REDIS_URL`, `GLITCHTIP_DOMAIN`.
4. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`
5. Открыть `https://errors.vycord.webvaha.ru`, создать первого
   пользователя/организацию, затем проект `vycord-client` — скопировать
   выданный DSN.
6. Вписать DSN в `.env.prod` (`VITE_SENTRY_DSN=...`) и в
   `client/electron/sentry-config.ts` (`SENTRY_DSN`, см. Task 8), пересобрать:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build client`
7. В настройках организации GlitchTip выключить `ENABLE_ORGANIZATION_CREATION`
   (убрать переменную/поставить `"false"` в `docker-compose.prod.yml`) —
   она нужна была только для создания первой организации.

## Чеклист деплоя

Порядок важен — при нарушении API не стартует или регистрация ломается молча.

1. `SMTP_HOST`, `SMTP_FROM`, `OTP_SECRET` (и при необходимости `SMTP_USERNAME`/`SMTP_PASSWORD`) прописаны в проде **до** раскатки — без них `config.New()` завершает процесс.
2. SPF, DKIM и DMARC настроены на домене отправителя. Без них письма с кодами массово уедут в спам, что для OTP означает «пользователь не может войти».
3. Применена миграция `019_email_otp`.
4. Проверена фактическая доставка на Gmail и Mail.ru — двух почтовиках с самой строгой фильтрацией.
5. Клиент раскатан одновременно с сервером: старый клиент не умеет шаг ввода кода при регистрации.
