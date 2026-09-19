package usecase_test

import (
	"bytes"
	"testing"

	"github.com/vycord/server/internal/usecase"
)

func TestGuestIPHash(t *testing.T) {
	key := []byte("k")
	h := func(ip string) []byte { return usecase.GuestIPHashForTest(key, ip) }

	if !bytes.Equal(h("203.0.113.9"), h("203.0.113.9")) {
		t.Fatal("same IPv4 must hash equal")
	}
	if bytes.Equal(h("203.0.113.9"), h("203.0.113.10")) {
		t.Fatal("different IPv4 must hash differently")
	}
	if !bytes.Equal(h("::ffff:203.0.113.9"), h("203.0.113.9")) {
		t.Fatal("IPv4-mapped IPv6 must hash like the IPv4 address")
	}
	if !bytes.Equal(h("2001:db8:1:2::1"), h("2001:db8:1:2:ffff::9")) {
		t.Fatal("addresses in the same IPv6 /64 must hash equal")
	}
	if bytes.Equal(h("2001:db8:1:2::1"), h("2001:db8:1:3::1")) {
		t.Fatal("different IPv6 /64 must hash differently")
	}
	if bytes.Equal(usecase.GuestIPHashForTest([]byte("other"), "203.0.113.9"), h("203.0.113.9")) {
		t.Fatal("the key must matter")
	}
	if len(h("not an ip")) != 32 {
		t.Fatal("unparseable input still yields a 32-byte HMAC")
	}
}
