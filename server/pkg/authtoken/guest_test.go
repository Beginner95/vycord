package authtoken

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestDeriveKey_DeterministicPerLabelAndDistinctFromSecret(t *testing.T) {
	a1 := DeriveKey(secret, GuestRoomKeyLabel)
	a2 := DeriveKey(secret, GuestRoomKeyLabel)
	b := DeriveKey(secret, GuestIPKeyLabel)

	if string(a1) != string(a2) {
		t.Fatal("same secret+label must derive the same key")
	}
	if string(a1) == string(b) {
		t.Fatal("different labels must derive different keys")
	}
	if string(a1) == secret {
		t.Fatal("derived key must differ from the secret itself")
	}
	if len(a1) != 32 {
		t.Fatalf("derived key length = %d, want 32", len(a1))
	}
}

func TestGuestRoomToken_RoundTrip(t *testing.T) {
	guestID, roomID := uuid.New(), uuid.New()
	before := time.Now()

	tok, err := GenerateGuestRoomToken(secret, guestID, roomID, time.Minute)
	if err != nil {
		t.Fatalf("GenerateGuestRoomToken: %v", err)
	}
	got, err := ValidateGuestRoomToken(secret, tok)
	if err != nil {
		t.Fatalf("ValidateGuestRoomToken: %v", err)
	}
	if got.GuestID != guestID || got.RoomID != roomID {
		t.Fatalf("got guest=%s room=%s, want guest=%s room=%s", got.GuestID, got.RoomID, guestID, roomID)
	}
	if got.JTI == "" {
		t.Fatal("jti must be set")
	}
	if got.ExpiresAt.Before(before.Add(59*time.Second)) || got.ExpiresAt.After(before.Add(61*time.Second)) {
		t.Fatalf("ExpiresAt = %v, want ~now+60s", got.ExpiresAt)
	}
}

func TestGuestRoomToken_JTIUniquePerToken(t *testing.T) {
	g, r := uuid.New(), uuid.New()
	t1, _ := GenerateGuestRoomToken(secret, g, r, time.Minute)
	t2, _ := GenerateGuestRoomToken(secret, g, r, time.Minute)
	c1, err1 := ValidateGuestRoomToken(secret, t1)
	c2, err2 := ValidateGuestRoomToken(secret, t2)
	if err1 != nil || err2 != nil {
		t.Fatalf("validate: %v / %v", err1, err2)
	}
	if c1.JTI == c2.JTI {
		t.Fatal("two tokens must carry different jti")
	}
	raw, err := base64.RawURLEncoding.DecodeString(c1.JTI)
	if err != nil || len(raw) != 16 {
		t.Fatalf("jti must be 16 bytes base64url-raw, got %q (err %v)", c1.JTI, err)
	}
}

func TestGuestRoomToken_CarriesNoUserIDClaim(t *testing.T) {
	tok, _ := GenerateGuestRoomToken(secret, uuid.New(), uuid.New(), time.Minute)
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(tok, claims, func(*jwt.Token) (any, error) {
		return DeriveKey(secret, GuestRoomKeyLabel), nil
	}); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if _, ok := claims["user_id"]; ok {
		t.Fatal("guest room token must not carry user_id")
	}
	if claims["typ"] != TypGuestRoom {
		t.Fatalf("typ = %v, want %q", claims["typ"], TypGuestRoom)
	}
}

// Н2: a guest room token is not an access token (signature does not verify
// under the main key) — this is the path RequireAuth and the /ws hub use.
func TestGuestRoomToken_RejectedByValidateToken(t *testing.T) {
	tok, _ := GenerateGuestRoomToken(secret, uuid.New(), uuid.New(), time.Minute)
	if _, err := ValidateToken(secret, tok); err == nil {
		t.Fatal("guest room token accepted by ValidateToken")
	}
}

// Н7 (guest-key half): a guest room token is not an account room token.
func TestGuestRoomToken_RejectedByValidateRoomToken(t *testing.T) {
	tok, _ := GenerateGuestRoomToken(secret, uuid.New(), uuid.New(), time.Minute)
	if _, _, err := ValidateRoomToken(secret, tok); err == nil {
		t.Fatal("guest room token accepted by ValidateRoomToken")
	}
}

// Н7 (main-key half): guest_room typ signed with the MAIN key is rejected.
func TestValidateGuestRoomToken_RejectsMainKeySignature(t *testing.T) {
	tok := hs256(t, secret, jwt.MapClaims{
		"typ":      TypGuestRoom,
		"guest_id": uuid.NewString(),
		"room_id":  uuid.NewString(),
		"jti":      "abc",
		"exp":      time.Now().Add(time.Minute).Unix(),
	})
	if _, err := ValidateGuestRoomToken(secret, tok); err == nil {
		t.Fatal("guest token signed with the main key accepted")
	}
}

// An account room token re-signed with the guest key still fails: wrong typ.
func TestValidateGuestRoomToken_RejectsRoomTypOnGuestKey(t *testing.T) {
	tok := sign(t, jwt.SigningMethodHS256, DeriveKey(secret, GuestRoomKeyLabel), jwt.MapClaims{
		"typ":     TypRoom,
		"user_id": uuid.NewString(),
		"room_id": uuid.NewString(),
		"exp":     time.Now().Add(time.Minute).Unix(),
	})
	if _, err := ValidateGuestRoomToken(secret, tok); err == nil {
		t.Fatal("room-typed token on the guest key accepted as a guest token")
	}
}

func guestKeyToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	return sign(t, jwt.SigningMethodHS256, DeriveKey(secret, GuestRoomKeyLabel), claims)
}

func validGuestClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"typ":      TypGuestRoom,
		"guest_id": uuid.NewString(),
		"room_id":  uuid.NewString(),
		"jti":      "jti-value",
		"iat":      time.Now().Unix(),
		"exp":      time.Now().Add(time.Minute).Unix(),
	}
}

func TestValidateGuestRoomToken_RejectsMalformedClaims(t *testing.T) {
	cases := map[string]func(jwt.MapClaims){
		"missing typ (no transition for guest tokens)": func(c jwt.MapClaims) { delete(c, "typ") },
		"user_id present":   func(c jwt.MapClaims) { c["user_id"] = uuid.NewString() },
		"missing guest_id":  func(c jwt.MapClaims) { delete(c, "guest_id") },
		"non-uuid guest_id": func(c jwt.MapClaims) { c["guest_id"] = "nope" },
		"missing room_id":   func(c jwt.MapClaims) { delete(c, "room_id") },
		"non-uuid room_id":  func(c jwt.MapClaims) { c["room_id"] = 5 },
		"missing jti":       func(c jwt.MapClaims) { delete(c, "jti") },
		"empty jti":         func(c jwt.MapClaims) { c["jti"] = "" },
		"missing exp":       func(c jwt.MapClaims) { delete(c, "exp") },
		"expired":           func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Second).Unix() },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			c := validGuestClaims()
			mutate(c)
			if _, err := ValidateGuestRoomToken(secret, guestKeyToken(t, c)); err == nil {
				t.Fatalf("accepted guest token with %s", name)
			}
		})
	}
}

func TestValidateGuestRoomToken_RejectsAlgNone(t *testing.T) {
	tok := sign(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, validGuestClaims())
	if _, err := ValidateGuestRoomToken(secret, tok); err == nil {
		t.Fatal("alg=none guest token accepted")
	}
}

func TestGuestIdentity_RoundTrip(t *testing.T) {
	id := uuid.New()
	s := GuestIdentity(id)
	if s != "guest:"+id.String() {
		t.Fatalf("GuestIdentity = %q", s)
	}
	got, ok := ParseGuestIdentity(s)
	if !ok || got != id {
		t.Fatalf("ParseGuestIdentity(%q) = (%s, %v)", s, got, ok)
	}
}

func TestParseGuestIdentity_RejectsNonGuest(t *testing.T) {
	for _, s := range []string{
		uuid.NewString(), // plain user id
		"guest:",         // empty
		"guest:not-a-uuid",
		"GUEST:" + uuid.NewString(), // prefix is case-sensitive
		" guest:" + uuid.NewString(),
	} {
		if _, ok := ParseGuestIdentity(s); ok {
			t.Fatalf("ParseGuestIdentity(%q) accepted", s)
		}
	}
}

func TestGenerateOpaqueSecret_HighEntropyBase64URL(t *testing.T) {
	a, err := GenerateOpaqueSecret()
	if err != nil {
		t.Fatalf("GenerateOpaqueSecret: %v", err)
	}
	b, _ := GenerateOpaqueSecret()
	if a == b {
		t.Fatal("two secrets must differ")
	}
	raw, err := base64.RawURLEncoding.DecodeString(a)
	if err != nil {
		t.Fatalf("not base64url-raw: %v", err)
	}
	if len(raw) != 32 {
		t.Fatalf("decoded length = %d, want 32", len(raw))
	}
	if strings.ContainsAny(a, "+/=") {
		t.Fatalf("secret %q must be URL-safe without padding", a)
	}
}

// An opaque secret is not a JWT: the account validators reject it at parse.
func TestOpaqueSecret_RejectedByAccountValidators(t *testing.T) {
	s, _ := GenerateOpaqueSecret()
	if _, err := ValidateToken(secret, s); err == nil {
		t.Fatal("opaque secret accepted by ValidateToken")
	}
	if _, _, err := ValidateRoomToken(secret, s); err == nil {
		t.Fatal("opaque secret accepted by ValidateRoomToken")
	}
}

func TestHashOpaqueSecret_SHA256(t *testing.T) {
	h1 := HashOpaqueSecret("a")
	h2 := HashOpaqueSecret("a")
	h3 := HashOpaqueSecret("b")
	if string(h1) != string(h2) || string(h1) == string(h3) || len(h1) != 32 {
		t.Fatalf("HashOpaqueSecret not a deterministic 32-byte hash: %x %x %x", h1, h2, h3)
	}
}
