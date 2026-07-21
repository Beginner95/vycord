package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/vycord/server/internal/config"
	"github.com/vycord/server/internal/delivery/http/handler"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/filestorage"
	"github.com/vycord/server/pkg/logger"
)

func main() {
	// Load .env file from project root
	envPath := os.Getenv("ENV_PATH")
	if envPath == "" {
		// Try common locations
		if _, err := os.Stat("../.env"); err == nil {
			envPath = "../.env"
		} else if _, err := os.Stat("../../.env"); err == nil {
			envPath = "../../.env"
		} else if _, err := os.Stat(".env"); err == nil {
			envPath = ".env"
		}
	}

	if envPath != "" {
		if err := godotenv.Load(envPath); err != nil {
			fmt.Println("Warning: Failed to load .env file:", err)
		}
	}

	// Initialize logger
	log := logger.New(slog.LevelInfo)

	// Load config
	cfg, err := config.New()
	if err != nil {
		log.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Connect to PostgreSQL
	db, err := postgres.New(cfg.PostgresDSN())
	if err != nil {
		log.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Connect to Redis
	rdb, err := postgres.NewRedis(cfg.RedisAddr())
	if err != nil {
		log.Error("failed to connect to redis", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	// Initialize repositories
	userRepo := postgres.NewUserRepository(db)
	serverRepo := postgres.NewServerRepository(db)
	channelRepo := postgres.NewChannelRepository(db)
	messageRepo := postgres.NewMessageRepository(db)
	callRepo := postgres.NewCallRepository(db)

	// Initialize file storage
	storage, err := filestorage.NewLocal("./uploads", "/uploads")
	if err != nil {
		log.Error("failed to initialize file storage", "error", err)
		os.Exit(1)
	}

	// Initialize usecases
	authUseCase := usecase.NewAuthUseCase(userRepo, cfg.JWTSecret, cfg.JWTExpiration)
	userUseCase := usecase.NewUserUseCase(userRepo, storage)
	serverUseCase := usecase.NewServerUseCase(serverRepo, channelRepo, userRepo)
	messageUseCase := usecase.NewMessageUseCase(messageRepo, channelRepo, serverRepo)
	callUseCase := usecase.NewCallUseCase(callRepo)
	turnUseCase := usecase.NewTURNUseCase(cfg.TURNSecret, cfg.TURNURLs, cfg.TURNTTL)

	// Initialize hub for WebSocket connections
	hub := ws.NewHub(log)
	go hub.Run()

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authUseCase, log)
	userHandler := handler.NewUserHandler(userUseCase, log)
	serverHandler := handler.NewServerHandler(serverUseCase, log)
	messageHandler := handler.NewMessageHandler(messageUseCase, hub, log)
	onlineUsersHandler := handler.NewOnlineUsersHandler(hub, userRepo, log)
	wsHandler := handler.NewWebSocketHandler(hub, authUseCase, callUseCase, userUseCase, log)
	turnHandler := handler.NewTURNHandler(turnUseCase, log)

	// Setup router
	router := http.NewServeMux()

	// Middleware
	authMid := middleware.NewAuthMiddleware(authUseCase, log)

	// Auth routes
	router.HandleFunc("POST /api/v1/auth/register", authHandler.Register)
	router.HandleFunc("POST /api/v1/auth/login", authHandler.Login)
	router.HandleFunc("GET /api/v1/auth/me", authMid.RequireAuth(userHandler.GetMe))

	// User routes
	router.HandleFunc("GET /api/v1/users/online", authMid.RequireAuth(onlineUsersHandler.GetOnlineUsers))
	router.HandleFunc("PUT /api/v1/users/me/last-visited", authMid.RequireAuth(userHandler.UpdateLastVisited))
	router.HandleFunc("GET /api/v1/users", authMid.RequireAuth(userHandler.SearchUsers))
	router.HandleFunc("GET /api/v1/users/{id}", authMid.RequireAuth(userHandler.GetUserByID))

	// Server routes
	router.HandleFunc("POST /api/v1/servers", authMid.RequireAuth(serverHandler.CreateServer))
	router.HandleFunc("GET /api/v1/servers/search", authMid.RequireAuth(serverHandler.SearchServers))
	router.HandleFunc("GET /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.GetServer))
	router.HandleFunc("GET /api/v1/servers", authMid.RequireAuth(serverHandler.GetUserServers))
	router.HandleFunc("POST /api/v1/servers/{id}/join", authMid.RequireAuth(serverHandler.JoinServer))
	router.HandleFunc("POST /api/v1/servers/{id}/leave", authMid.RequireAuth(serverHandler.LeaveServer))

	// Channel routes
	router.HandleFunc("POST /api/v1/servers/{server_id}/channels", authMid.RequireAuth(serverHandler.CreateChannel))
	router.HandleFunc("GET /api/v1/servers/{server_id}/channels", authMid.RequireAuth(serverHandler.GetChannels))

	// Server member routes
	router.HandleFunc("GET /api/v1/servers/{server_id}/members", authMid.RequireAuth(serverHandler.GetMembers))

	// Message routes
	router.HandleFunc("POST /api/v1/channels/{channel_id}/messages", authMid.RequireAuth(messageHandler.CreateMessage))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages", authMid.RequireAuth(messageHandler.GetMessages))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/search", authMid.RequireAuth(messageHandler.SearchMessages))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/around/{message_id}", authMid.RequireAuth(messageHandler.GetMessagesAround))
	router.HandleFunc("PATCH /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.UpdateMessage))
	router.HandleFunc("DELETE /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.DeleteMessage))

	// TURN credentials for WebRTC (ephemeral, per-user)
	router.HandleFunc("GET /api/v1/turn/credentials", authMid.RequireAuth(turnHandler.GetCredentials))

	// WebSocket route
	router.HandleFunc("GET /ws", wsHandler.HandleWebSocket)

	// Wrap router with CORS middleware
	corsMid := middleware.DefaultCORS()
	if cfg.ClientURL != "" {
		corsMid.AllowedOrigins = append(corsMid.AllowedOrigins, cfg.ClientURL)
	}
	handlerWithCORS := corsMid.Handler(router)

	// Request ID + access logging wrap the whole stack so every request,
	// including CORS preflight, gets a trace ID and a log line.
	handlerWithLogging := middleware.Logging(log)(handlerWithCORS)
	rootHandler := middleware.RequestID(handlerWithLogging)

	// Start server
	srv := &http.Server{
		Addr:    cfg.ServerAddr(),
		Handler: rootHandler,
	}

	// Graceful shutdown
	go func() {
		log.Info("starting server", "addr", cfg.ServerAddr())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Error("server forced to shutdown", "error", err)
		os.Exit(1)
	}

	log.Info("server stopped")
}
