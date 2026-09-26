package phonecrypto

import (
	"strings"
	"testing"
)

var keyBytes = []byte("0123456789abcdef0123456789abcdef") // 32 байта

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"8 912 345-67-89", "+79123456789"},
		{"+7 (912) 345-67-89", "+79123456789"},
		{"+79123456789", "+79123456789"},
		{"89123456789", "+79123456789"},
		{"+7 912 345 67 89", "+79123456789"},
	}
	for _, c := range cases {
		got, err := Normalize(c.in)
		if err != nil {
			t.Fatalf("Normalize(%q): %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeInvalid(t *testing.T) {
	for _, in := range []string{"", "   ", "abc", "123", "+12345", "8", "8-912-345-67-8a", "++7912", "+7 912 345 678 901 234 567"} {
		if _, err := Normalize(in); err == nil {
			t.Errorf("Normalize(%q) expected error", in)
		}
	}
}

func TestIndexDeterministic(t *testing.T) {
	a, err := Index(keyBytes, "+79123456789")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Index(keyBytes, "+79123456789")
	if a != b {
		t.Fatal("index must be deterministic for the same number")
	}
	c, _ := Index(keyBytes, "+79998887766")
	if a == c {
		t.Fatal("different numbers must produce different indexes")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	blob, err := Encrypt(keyBytes, "+79123456789")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := Decrypt(keyBytes, blob)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "+79123456789" {
		t.Fatalf("round trip = %q", plain)
	}
}

func TestEncryptRandomized(t *testing.T) {
	a, _ := Encrypt(keyBytes, "+79123456789")
	b, _ := Encrypt(keyBytes, "+79123456789")
	if a == b {
		t.Fatal("ciphertexts must differ (random nonce)")
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt(keyBytes, "+79123456789")
	_, err := Decrypt([]byte(strings.Repeat("x", 32)), blob)
	if err == nil {
		t.Fatal("expected error on wrong key")
	}
}

func TestMask(t *testing.T) {
	if got := Mask("+79123456789"); got != "+79123 ••• •• 89" {
		t.Fatalf("Mask = %q", got)
	}
}
