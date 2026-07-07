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
Продление рвёт активные relay-аллокации (~раз в 60 дней, ночью) — ICE у
клиентов переустанавливается сам.
