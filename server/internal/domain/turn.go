package domain

// TURNCredentials are ephemeral credentials for a TURN server generated per
// the coturn REST API convention (use-auth-secret): the username embeds the
// expiry timestamp and the credential is an HMAC over it, so no per-user
// state is stored on the TURN server.
type TURNCredentials struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
	TTLSeconds int      `json:"ttl"`
}
