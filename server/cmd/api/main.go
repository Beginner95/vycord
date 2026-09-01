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
	"github.com/vycord/server/internal/attachments"
	"github.com/vycord/server/internal/config"
	"github.com/vycord/server/internal/delivery/http/handler"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	presencepkg "github.com/vycord/server/internal/presence"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/attachlink"
	"github.com/vycord/server/pkg/filestorage"
	"github.com/vycord/server/pkg/logger"
	"github.com/vycord/server/pkg/mailer"
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
	roleRepo := postgres.NewRoleRepository(db)
	inviteRepo := postgres.NewInviteRepository(db)
	stickerRepo := postgres.NewStickerRepository(db)
	refreshTokenRepo := postgres.NewRefreshTokenRepository(db)
	attachmentRepo := postgres.NewAttachmentRepository(db)
	planRepo := postgres.NewPlanRepository(db)
	otpRepo := postgres.NewOTPRepository(db)

	// Initialize file storage
	storage, err := filestorage.NewLocal(cfg.UploadDir, "/uploads")
	if err != nil {
		log.Error("failed to initialize file storage", "error", err)
		os.Exit(1)
	}

	// Initialize usecases
	appMailer := mailer.NewSMTP(mailer.Config{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		From:     cfg.SMTPFrom,
		FromName: cfg.SMTPFromName,
	})

	// otpUseCase создаётся раньше authUseCase: Register в authUseCase
	// отправляет код регистрации через узкий срез domain.OTPSender.
	otpUseCase := usecase.NewOTPUseCase(
		userRepo, otpRepo, appMailer, refreshTokenRepo,
		cfg.JWTSecret, cfg.JWTExpiration, cfg.RefreshTokenExpiration,
		usecase.OTPPolicy{
			Secret:         cfg.OTPSecret,
			TTL:            cfg.OTPTTL,
			MaxAttempts:    cfg.OTPMaxAttempts,
			ResendCooldown: cfg.OTPResendCooldown,
			MaxPerHour:     cfg.OTPMaxPerHour,
		},
		log,
	)

	authUseCase := usecase.NewAuthUseCase(userRepo, refreshTokenRepo, otpUseCase, cfg.JWTSecret, cfg.JWTExpiration, cfg.RefreshTokenExpiration)
	userUseCase := usecase.NewUserUseCase(userRepo, storage)
	permissionUseCase := usecase.NewPermissionUseCase(serverRepo, roleRepo)
	inviteUseCase := usecase.NewInviteUseCase(inviteRepo, serverRepo, permissionUseCase)
	roleUseCase := usecase.NewRoleUseCase(serverRepo, roleRepo, permissionUseCase)
	serverUseCase := usecase.NewServerUseCase(serverRepo, channelRepo, userRepo, roleRepo, storage, permissionUseCase)
	voiceTokenUseCase := usecase.NewVoiceTokenUseCase(serverUseCase, cfg.JWTSecret)
	messageUseCase := usecase.NewMessageUseCase(messageRepo, channelRepo, serverRepo, stickerRepo, permissionUseCase, attachmentRepo, storage)
	stickerUseCase := usecase.NewStickerUseCase(stickerRepo, serverRepo, permissionUseCase, storage)

	// Кэш плана на 5 минут: таблица крошечная и меняется редко, ходить в БД
	// на каждую загрузку незачем, а смена тарифа подхватится сама.
	quotaUseCase := usecase.NewQuotaUseCase(planRepo, attachmentRepo, 5*time.Minute)
	attachmentUseCase := usecase.NewAttachmentUseCase(attachmentRepo, channelRepo, permissionUseCase, quotaUseCase, storage)

	attachmentSigner := attachlink.NewSigner(cfg.JWTSecret, cfg.AttachmentLinkTTL)
	callUseCase := usecase.NewCallUseCase(callRepo)
	turnUseCase := usecase.NewTURNUseCase(cfg.TURNSecret, cfg.TURNURLs, cfg.TURNTTL)

	// Initialize hub for WebSocket connections
	hub := ws.NewHub(log)
	hub.SetVoiceAudienceResolver(serverUseCase.GetChannelAudience)
	go hub.Run()

	// Общий контекст фоновых задач: его отмена останавливает и воркер
	// voice-presence, и уборщик вложений. Создаётся безусловно — уборщик
	// обязан работать даже там, где presence выключен, — поэтому не
	// переносить внутрь условия ниже.
	bgCtx, stopBackgroundWorkers := context.WithCancel(context.Background())
	defer stopBackgroundWorkers()

	// Voice-presence reconciliation against the SFU's own /presence snapshot
	// (VYC-78 step 4) — corrects drift in hub.voiceChannels instead of trusting
	// client-driven voice_joined/voice_left as the sole source of truth. Both
	// vars empty just means the worker doesn't run: this is a correctness
	// safety net, not something API startup should ever depend on.
	if cfg.SFUInternalURL != "" && cfg.SFUInternalSecret != "" {
		fetcher := presencepkg.NewHTTPFetcher(cfg.SFUInternalURL, cfg.SFUInternalSecret)
		presenceWorker := presencepkg.NewWorker(fetcher, hub, log)
		go presenceWorker.Run(bgCtx)
		log.Info("voice-presence reconciliation started", "sfu_url", cfg.SFUInternalURL, "interval", presencepkg.DefaultInterval)
	} else {
		log.Warn("SFU_INTERNAL_URL or SFU_INTERNAL_SECRET not set — voice-presence reconciliation disabled")
	}

	// Уборщик брошенных (не привязанных к сообщению) и протухших вложений.
	janitor := attachments.NewJanitor(attachmentRepo, storage, log)
	go janitor.Run(bgCtx)

	// Уборка истёкших кодов и брошенных регистраций.
	go usecase.NewOTPCleaner(otpRepo, userRepo, cfg.UnverifiedUserTTL, log).Run(bgCtx, time.Hour)

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authUseCase, log)
	otpHandler := handler.NewOTPHandler(otpUseCase, log)
	userHandler := handler.NewUserHandler(userUseCase, hub, log)
	serverHandler := handler.NewServerHandler(serverUseCase, inviteUseCase, hub, log)
	inviteHandler := handler.NewInviteHandler(inviteUseCase, log)
	messageHandler := handler.NewMessageHandler(messageUseCase, hub, log, attachmentSigner)
	stickerHandler := handler.NewStickerHandler(stickerUseCase, log)
	onlineUsersHandler := handler.NewOnlineUsersHandler(hub, userRepo, log)
	wsHandler := handler.NewWebSocketHandler(hub, authUseCase, callUseCase, userUseCase, serverUseCase, log)
	turnHandler := handler.NewTURNHandler(turnUseCase, log)
	roleHandler := handler.NewRoleHandler(roleUseCase, permissionUseCase, log)
	voiceTokenHandler := handler.NewVoiceTokenHandler(voiceTokenUseCase, log)
	attachmentHandler := handler.NewAttachmentHandler(attachmentUseCase, quotaUseCase, attachmentSigner, cfg.MaxUploadBytes, log)

	// Setup router
	router := http.NewServeMux()

	// Middleware
	authMid := middleware.NewAuthMiddleware(authUseCase, log)

	// Health check for uptime monitoring
	router.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// Auth routes
	router.HandleFunc("POST /api/v1/auth/register", authHandler.Register)
	router.HandleFunc("POST /api/v1/auth/login", authHandler.Login)
	router.HandleFunc("POST /api/v1/auth/refresh", authHandler.Refresh)
	router.HandleFunc("POST /api/v1/auth/logout", authHandler.Logout)
	router.HandleFunc("GET /api/v1/auth/me", authMid.RequireAuth(userHandler.GetMe))
	router.HandleFunc("POST /api/v1/auth/register/resend", otpHandler.RequestRegistrationCode)
	router.HandleFunc("POST /api/v1/auth/register/verify", otpHandler.VerifyRegistration)
	router.HandleFunc("POST /api/v1/auth/otp/request", otpHandler.RequestLoginCode)
	router.HandleFunc("POST /api/v1/auth/otp/verify", otpHandler.VerifyLogin)

	// User routes
	router.HandleFunc("GET /api/v1/users/online", authMid.RequireAuth(onlineUsersHandler.GetOnlineUsers))
	router.HandleFunc("PUT /api/v1/users/me/last-visited", authMid.RequireAuth(userHandler.UpdateLastVisited))
	router.HandleFunc("GET /api/v1/users", authMid.RequireAuth(userHandler.SearchUsers))
	router.HandleFunc("GET /api/v1/users/{id}", authMid.RequireAuth(userHandler.GetUserByID))
	router.HandleFunc("POST /api/v1/users/me/avatar", authMid.RequireAuth(userHandler.UploadAvatar))
	router.HandleFunc("DELETE /api/v1/users/me/avatar", authMid.RequireAuth(userHandler.RemoveAvatar))

	// Server routes
	router.HandleFunc("POST /api/v1/servers", authMid.RequireAuth(serverHandler.CreateServer))
	router.HandleFunc("GET /api/v1/servers/search", authMid.RequireAuth(serverHandler.SearchServers))
	router.HandleFunc("GET /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.GetServer))
	router.HandleFunc("GET /api/v1/servers", authMid.RequireAuth(serverHandler.GetUserServers))
	router.HandleFunc("POST /api/v1/servers/{id}/join", authMid.RequireAuth(serverHandler.JoinServer))
	router.HandleFunc("POST /api/v1/servers/{id}/leave", authMid.RequireAuth(serverHandler.LeaveServer))
	router.HandleFunc("PATCH /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.UpdateServer))
	router.HandleFunc("DELETE /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.DeleteServer))
	router.HandleFunc("POST /api/v1/servers/{id}/icon", authMid.RequireAuth(serverHandler.UploadServerIcon))
	router.HandleFunc("DELETE /api/v1/servers/{id}/icon", authMid.RequireAuth(serverHandler.RemoveServerIcon))

	// Sticker routes
	router.HandleFunc("POST /api/v1/servers/{id}/stickers", authMid.RequireAuth(stickerHandler.CreateSticker))
	router.HandleFunc("GET /api/v1/servers/{id}/stickers", authMid.RequireAuth(stickerHandler.ListStickers))
	router.HandleFunc("DELETE /api/v1/servers/{id}/stickers/{sticker_id}", authMid.RequireAuth(stickerHandler.DeleteSticker))

	// Channel routes
	router.HandleFunc("POST /api/v1/servers/{server_id}/channels", authMid.RequireAuth(serverHandler.CreateChannel))
	router.HandleFunc("GET /api/v1/servers/{server_id}/channels", authMid.RequireAuth(serverHandler.GetChannels))
	router.HandleFunc("PATCH /api/v1/servers/{server_id}/channels/{channel_id}", authMid.RequireAuth(serverHandler.UpdateChannel))
	router.HandleFunc("DELETE /api/v1/servers/{server_id}/channels/{channel_id}", authMid.RequireAuth(serverHandler.DeleteChannel))

	// Invite routes
	router.HandleFunc("POST /api/v1/servers/{server_id}/invites", authMid.RequireAuth(inviteHandler.CreateInvite))
	router.HandleFunc("GET /api/v1/servers/{server_id}/invites", authMid.RequireAuth(inviteHandler.ListInvites))
	router.HandleFunc("DELETE /api/v1/servers/{server_id}/invites/{code}", authMid.RequireAuth(inviteHandler.RevokeInvite))
	router.HandleFunc("GET /api/v1/invites/{code}", authMid.RequireAuth(inviteHandler.PreviewInvite))
	router.HandleFunc("POST /api/v1/invites/{code}/join", authMid.RequireAuth(inviteHandler.JoinViaInvite))

	// Server member routes
	router.HandleFunc("GET /api/v1/servers/{server_id}/members", authMid.RequireAuth(serverHandler.GetMembers))

	// Role routes
	router.HandleFunc("GET /api/v1/servers/{server_id}/roles", authMid.RequireAuth(roleHandler.ListRoles))
	router.HandleFunc("POST /api/v1/servers/{server_id}/roles", authMid.RequireAuth(roleHandler.CreateRole))
	router.HandleFunc("PATCH /api/v1/servers/{server_id}/roles/{role_id}", authMid.RequireAuth(roleHandler.UpdateRole))
	router.HandleFunc("DELETE /api/v1/servers/{server_id}/roles/{role_id}", authMid.RequireAuth(roleHandler.DeleteRole))
	router.HandleFunc("PUT /api/v1/servers/{server_id}/members/{user_id}/roles/{role_id}", authMid.RequireAuth(roleHandler.AssignRole))
	router.HandleFunc("DELETE /api/v1/servers/{server_id}/members/{user_id}/roles/{role_id}", authMid.RequireAuth(roleHandler.UnassignRole))
	router.HandleFunc("GET /api/v1/servers/{server_id}/members/me/permissions", authMid.RequireAuth(roleHandler.GetMyPermissions))

	// Message routes
	router.HandleFunc("POST /api/v1/channels/{channel_id}/messages", authMid.RequireAuth(messageHandler.CreateMessage))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages", authMid.RequireAuth(messageHandler.GetMessages))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/search", authMid.RequireAuth(messageHandler.SearchMessages))
	router.HandleFunc("GET /api/v1/channels/{channel_id}/messages/around/{message_id}", authMid.RequireAuth(messageHandler.GetMessagesAround))
	router.HandleFunc("PATCH /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.UpdateMessage))
	router.HandleFunc("DELETE /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.DeleteMessage))

	// Вложения. Загрузка, метаданные и удаление — под авторизацией.
	router.HandleFunc("POST /api/v1/attachments", authMid.RequireAuth(attachmentHandler.Upload))
	router.HandleFunc("GET /api/v1/attachments/{id}", authMid.RequireAuth(attachmentHandler.Get))
	router.HandleFunc("DELETE /api/v1/attachments/{id}", authMid.RequireAuth(attachmentHandler.Delete))

	// Отдача содержимого — БЕЗ RequireAuth: <img src> и <video src> не умеют
	// слать заголовок Authorization, поэтому доступ даёт подпись в URL
	// (см. pkg/attachlink).
	router.HandleFunc("GET /api/v1/attachments/{id}/content", attachmentHandler.Content)
	router.HandleFunc("GET /api/v1/attachments/{id}/thumb", attachmentHandler.Thumb)

	// Voice token — short-lived, room-scoped JWT for the SFU (see private channels design doc)
	router.HandleFunc("POST /api/v1/channels/{channel_id}/voice-token", authMid.RequireAuth(voiceTokenHandler.IssueToken))

	// TURN credentials for WebRTC (ephemeral, per-user)
	router.HandleFunc("GET /api/v1/turn/credentials", authMid.RequireAuth(turnHandler.GetCredentials))

	// Статика загрузок: только публичные подкаталоги (см. newUploadsHandler).
	router.Handle("GET /uploads/", newUploadsHandler(cfg.UploadDir))

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
