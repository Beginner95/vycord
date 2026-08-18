// Package httpapi holds the SFU's non-signaling HTTP surface: service
// endpoints like /stats and /presence that exist for operators and the API
// server, not for WebRTC clients.
package httpapi

import (
	"crypto/subtle"
	"net/http"
)

// internalSecretHeader carries the shared secret that scopes /stats and
// /presence to the API server (and operators with shell access), instead of
// being reachable by anyone on the internet — see VYC-78 8.3: the SFU listens
// on ":"+port under network_mode: host, so without this these endpoints were
// confirmed reachable from outside, unauthenticated.
const internalSecretHeader = "X-Internal-Secret"

// RequireInternalSecret wraps next so it only runs when the request carries
// internalSecretHeader matching secret exactly.
//
// An empty secret rejects every request rather than accepting every request:
// an operator who never configured SFU_INTERNAL_SECRET gets a locked endpoint,
// which is the safe failure mode for something that used to be open to the
// whole internet — not a silently-open one.
//
// The comparison is constant-time: this header is a long-lived static secret
// shared between two of our own services, and a timing side-channel on it
// costs nothing to close.
func RequireInternalSecret(secret string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get(internalSecretHeader)
		if secret == "" || len(got) != len(secret) ||
			subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}
