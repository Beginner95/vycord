package authtoken

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const secret = "unit-test-secret"

func sign(t *testing.T, method jwt.SigningMethod, key any, claims jwt.MapClaims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(method, claims).SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func hs256(t *testing.T, key string, claims jwt.MapClaims) string {
	t.Helper()
	return sign(t, jwt.SigningMethodHS256, []byte(key), claims)
}

func TestValidToken(t *testing.T) {
	want := uuid.New()
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": want.String(),
		"exp":     time.Now().Add(time.Hour).Unix(),
	})

	got, err := ValidateToken(secret, tok)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if got != want {
		t.Fatalf("user id = %s, want %s", got, want)
	}
}

func TestExpiredToken(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": uuid.NewString(),
		"exp":     time.Now().Add(-time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestWrongSignature(t *testing.T) {
	tok := hs256(t, "another-secret", jwt.MapClaims{
		"user_id": uuid.NewString(),
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("token signed with a different secret accepted")
	}
}

func TestAlgNone(t *testing.T) {
	tok := sign(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, jwt.MapClaims{
		"user_id": uuid.NewString(),
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("alg=none token accepted")
	}
}

func TestMissingUserID(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("token without user_id accepted")
	}
}

func TestNonStringUserID(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": 42,
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("token with non-string user_id accepted")
	}
}

func TestNonUUIDUserID(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": "not-a-uuid",
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("token with non-UUID user_id accepted")
	}
}

func TestGenerateAndValidateRoomToken(t *testing.T) {
	userID := uuid.New()
	roomID := uuid.New()

	tok, err := GenerateRoomToken(secret, userID, roomID, time.Hour)
	if err != nil {
		t.Fatalf("GenerateRoomToken: %v", err)
	}

	gotUser, gotRoom, err := ValidateRoomToken(secret, tok)
	if err != nil {
		t.Fatalf("ValidateRoomToken: %v", err)
	}
	if gotUser != userID {
		t.Fatalf("user id = %s, want %s", gotUser, userID)
	}
	if gotRoom != roomID {
		t.Fatalf("room id = %s, want %s", gotRoom, roomID)
	}
}

func TestValidateRoomToken_RejectsTokenWithoutRoomID(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": uuid.NewString(),
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	if _, _, err := ValidateRoomToken(secret, tok); err == nil {
		t.Fatal("token without room_id accepted")
	}
}

func TestValidateRoomToken_RejectsExpiredToken(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": uuid.NewString(),
		"room_id": uuid.NewString(),
		"exp":     time.Now().Add(-time.Hour).Unix(),
	})
	if _, _, err := ValidateRoomToken(secret, tok); err == nil {
		t.Fatal("expired room token accepted")
	}
}

func TestValidateToken_StillIgnoresRoomIDClaim(t *testing.T) {
	// The general-purpose login token has no room_id — ValidateToken must
	// keep accepting it unchanged after refactoring into shared claim parsing.
	want := uuid.New()
	tok := hs256(t, secret, jwt.MapClaims{
		"user_id": want.String(),
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	got, err := ValidateToken(secret, tok)
	if err != nil {
		t.Fatalf("ValidateToken: %v", err)
	}
	if got != want {
		t.Fatalf("user id = %s, want %s", got, want)
	}
}

func TestGenerateRefreshToken_ReturnsNonEmptyUniqueValues(t *testing.T) {
	a, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken: %v", err)
	}
	b, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken: %v", err)
	}
	if a == "" || b == "" {
		t.Fatal("expected non-empty tokens")
	}
	if a == b {
		t.Fatal("expected two calls to produce different tokens")
	}
	if len(a) < 32 {
		t.Fatalf("expected a high-entropy token, got length %d", len(a))
	}
}

func TestHashRefreshToken_DeterministicAndDistinct(t *testing.T) {
	h1 := HashRefreshToken("token-a")
	h2 := HashRefreshToken("token-a")
	h3 := HashRefreshToken("token-b")

	if string(h1) != string(h2) {
		t.Fatal("expected the same input to hash the same way")
	}
	if string(h1) == string(h3) {
		t.Fatal("expected different inputs to hash differently")
	}
	if len(h1) != 32 {
		t.Fatalf("expected a 32-byte SHA-256 hash, got %d bytes", len(h1))
	}
}
