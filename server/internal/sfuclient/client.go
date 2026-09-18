// Package sfuclient is the API's side of the SFU's internal HTTP API
// (X-Internal-Secret): evicting a guest and reading guest presence. The
// read-only /presence call used by voice reconciliation lives in
// internal/presence and stays there.
package sfuclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/vycord/server/pkg/authtoken"
)

const requestTimeout = 5 * time.Second

type Client struct {
	baseURL string
	secret  string
	client  *http.Client
}

// New builds a client against the SFU's internal base URL (SFU_INTERNAL_URL).
func New(baseURL, secret string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		secret:  secret,
		client:  &http.Client{Timeout: requestTimeout},
	}
}

// KickGuest evicts identity from roomID. A nil client is a no-op: in a dev
// setup without SFU_INTERNAL_URL the guest still loses their session and their
// gateway connection, which is what actually gates media.
func (c *Client) KickGuest(ctx context.Context, roomID uuid.UUID, identity string) error {
	if c == nil {
		return nil
	}
	body, err := json.Marshal(map[string]string{"room_id": roomID.String(), "identity": identity})
	if err != nil {
		return fmt.Errorf("encode kick request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/kick", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build kick request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", c.secret)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("kick request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("SFU /kick returned status %d", resp.StatusCode)
	}
	return nil
}

// GuestPresence returns room → guest IDs as the SFU sees them right now.
// Identities that are not guest identities are skipped rather than failing the
// call: this snapshot is a safety net, and a single odd entry must not disable it.
func (c *Client) GuestPresence(ctx context.Context) (map[uuid.UUID][]uuid.UUID, error) {
	if c == nil {
		return map[uuid.UUID][]uuid.UUID{}, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/guest-presence", nil)
	if err != nil {
		return nil, fmt.Errorf("build guest presence request: %w", err)
	}
	req.Header.Set("X-Internal-Secret", c.secret)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("guest presence request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SFU /guest-presence returned status %d", resp.StatusCode)
	}

	var raw map[string][]string
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode guest presence: %w", err)
	}

	out := make(map[uuid.UUID][]uuid.UUID, len(raw))
	for rawRoom, identities := range raw {
		roomID, err := uuid.Parse(rawRoom)
		if err != nil {
			continue
		}
		var guests []uuid.UUID
		for _, identity := range identities {
			if guestID, ok := authtoken.ParseGuestIdentity(identity); ok {
				guests = append(guests, guestID)
			}
		}
		if len(guests) > 0 {
			out[roomID] = guests
		}
	}
	return out, nil
}
