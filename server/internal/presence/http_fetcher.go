package presence

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// fetchTimeout bounds a single /presence call so a hung or slow-to-respond
// SFU cannot stall a reconciliation tick indefinitely.
const fetchTimeout = 5 * time.Second

// HTTPFetcher fetches the SFU's /presence snapshot over HTTP, authenticating
// with the shared internal secret (VYC-78 8.3 — /presence is closed to the
// open internet the same way /stats is).
type HTTPFetcher struct {
	baseURL string
	secret  string
	client  *http.Client
}

// NewHTTPFetcher builds a Fetcher against the SFU's base URL (e.g.
// "http://host.docker.internal:8081" in prod, "http://localhost:8081" in
// dev — see SFU_INTERNAL_URL).
func NewHTTPFetcher(baseURL, secret string) *HTTPFetcher {
	return &HTTPFetcher{
		baseURL: strings.TrimRight(baseURL, "/"),
		secret:  secret,
		client:  &http.Client{Timeout: fetchTimeout},
	}
}

func (f *HTTPFetcher) Fetch(ctx context.Context) (map[string][]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.baseURL+"/presence", nil)
	if err != nil {
		return nil, fmt.Errorf("build presence request: %w", err)
	}
	req.Header.Set("X-Internal-Secret", f.secret)

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("presence request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SFU /presence returned status %d", resp.StatusCode)
	}

	var snapshot map[string][]string
	if err := json.NewDecoder(resp.Body).Decode(&snapshot); err != nil {
		return nil, fmt.Errorf("decode presence response: %w", err)
	}
	return snapshot, nil
}
