package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type TURNHandler struct {
	turnUseCase domain.TURNUseCase
	log         *slog.Logger
}

func NewTURNHandler(turnUseCase domain.TURNUseCase, log *slog.Logger) *TURNHandler {
	return &TURNHandler{
		turnUseCase: turnUseCase,
		log:         log,
	}
}

type iceServerResponse struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type turnCredentialsResponse struct {
	ICEServers []iceServerResponse `json:"ice_servers"`
	TTLSeconds int                 `json:"ttl"`
}

// GetCredentials returns ephemeral TURN credentials for the authenticated user.
// When no TURN server is configured the list is empty and clients fall back
// to STUN-only ICE.
func (h *TURNHandler) GetCredentials(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	creds, err := h.turnUseCase.GetCredentials(userID)
	if err != nil {
		h.log.Error("failed to generate turn credentials", "user_id", userID, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to generate turn credentials"})
		return
	}

	resp := turnCredentialsResponse{ICEServers: []iceServerResponse{}}
	if creds != nil {
		resp.ICEServers = append(resp.ICEServers, iceServerResponse{
			URLs:       creds.URLs,
			Username:   creds.Username,
			Credential: creds.Credential,
		})
		resp.TTLSeconds = creds.TTLSeconds
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}
