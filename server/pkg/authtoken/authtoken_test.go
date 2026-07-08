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
