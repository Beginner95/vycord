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
| DeepFilterNet noise cancellation | 🚧 TODO |
| Screen sharing | 🚧 TODO |
| File uploads | 🚧 TODO |
| Windows 11 installer | 🚧 TODO |
