package usecase

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTURNGetCredentials(t *testing.T) {
	userID := uuid.MustParse("3f2504e0-4f89-11d3-9a0c-0305e82c3301")
	now := time.Unix(1751856800, 0)
	ttl := 12 * time.Hour // expiry = 1751900000

	uc := NewTURNUseCase(
		"test-turn-secret",
		[]string{"turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"},
		ttl,
	)
	uc.(*turnUseCase).now = func() time.Time { return now }

	creds, err := uc.GetCredentials(userID)
	if err != nil {
		t.Fatalf("GetCredentials returned error: %v", err)
	}
	if creds == nil {
		t.Fatal("expected credentials, got nil")
	}

	// username = "<expiry-unix>:<user-id>" (coturn REST API convention)
	wantUsername := "1751900000:3f2504e0-4f89-11d3-9a0c-0305e82c3301"
	if creds.Username != wantUsername {
		t.Errorf("username = %q, want %q", creds.Username, wantUsername)
	}

	// Reference value computed independently:
	// printf '%s' "1751900000:3f2504e0-..." | openssl dgst -sha1 -hmac "test-turn-secret" -binary | base64
	wantCredential := "O/hYcWB4DjZmYK/zIXHr2z8rhN0="
	if creds.Credential != wantCredential {
		t.Errorf("credential = %q, want %q", creds.Credential, wantCredential)
	}

	if len(creds.URLs) != 2 || creds.URLs[0] != "turn:turn.example.com:3478?transport=udp" {
		t.Errorf("unexpected URLs: %v", creds.URLs)
	}
	if creds.TTLSeconds != int(ttl.Seconds()) {
		t.Errorf("ttl = %d, want %d", creds.TTLSeconds, int(ttl.Seconds()))
	}

	// Sanity: credential must verify against the same HMAC the coturn server computes.
	mac := hmac.New(sha1.New, []byte("test-turn-secret"))
	mac.Write([]byte(creds.Username))
	if got := base64.StdEncoding.EncodeToString(mac.Sum(nil)); got != creds.Credential {
		t.Errorf("credential does not match HMAC-SHA1 of username: %q != %q", creds.Credential, got)
	}
}

func TestTURNGetCredentialsNotConfigured(t *testing.T) {
	cases := []struct {
		name   string
		secret string
		urls   []string
	}{
		{"no secret", "", []string{"turn:turn.example.com:3478"}},
		{"no urls", "secret", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uc := NewTURNUseCase(tc.secret, tc.urls, time.Hour)
			creds, err := uc.GetCredentials(uuid.New())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if creds != nil {
				t.Fatalf("expected nil credentials when TURN is not configured, got %+v", creds)
			}
		})
	}
}

func TestTURNGetCredentialsForIdentity(t *testing.T) {
	now := time.Unix(1751856800, 0)
	uc := NewTURNUseCase("test-turn-secret", []string{"turn:turn.example.com:3478"}, 12*time.Hour)
	uc.(*turnUseCase).now = func() time.Time { return now }

	creds, err := uc.GetCredentialsForIdentity("guest:3f2504e0-4f89-11d3-9a0c-0305e82c3301", time.Hour)
	if err != nil || creds == nil {
		t.Fatalf("GetCredentialsForIdentity = (%v, %v)", creds, err)
	}
	wantUser := "1751860400:guest:3f2504e0-4f89-11d3-9a0c-0305e82c3301"
	if creds.Username != wantUser {
		t.Fatalf("username = %q, want %q", creds.Username, wantUser)
	}
	if creds.TTLSeconds != 3600 {
		t.Fatalf("ttl = %d, want 3600", creds.TTLSeconds)
	}
	mac := hmac.New(sha1.New, []byte("test-turn-secret"))
	mac.Write([]byte(wantUser))
	if creds.Credential != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("credential is not the coturn REST HMAC of the username")
	}

	unconfigured := NewTURNUseCase("", nil, time.Hour)
	if c, err := unconfigured.GetCredentialsForIdentity("guest:x", time.Hour); c != nil || err != nil {
		t.Fatalf("unconfigured TURN must return (nil, nil), got (%v, %v)", c, err)
	}
}
