package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/vycord/server/internal/sfu/application"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
	"github.com/vycord/server/internal/sfu/transport/signaling"
	"github.com/vycord/server/pkg/logger"
)

func main() {
	log := logger.New(slog.LevelDebug)

	port := os.Getenv("SFU_PORT")
	if port == "" {
		port = "8081"
	}

	iceURLs := []string{
		"stun:stun.l.google.com:19302",
		"stun:stun1.l.google.com:19302",
	}
	if turnURL := os.Getenv("TURN_URL"); turnURL != "" {
		iceURLs = append(iceURLs, turnURL)
	}

	publicIP := os.Getenv("SFU_PUBLIC_IP") // set when SFU runs behind Docker NAT

	peerFactory, err := sfuwebrtc.NewPeerFactory(iceURLs, publicIP)
	if err != nil {
		log.Error("failed to create peer factory", "error", err)
		os.Exit(1)
	}

	manager := application.NewRoomManager(peerFactory, log)
	handler := signaling.NewHandler(manager, log)

	mux := http.NewServeMux()
	mux.Handle("/ws", handler)

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Info("SFU server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("SFU server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down SFU server")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("forced shutdown", "error", err)
	}
	log.Info("SFU server stopped")
}
