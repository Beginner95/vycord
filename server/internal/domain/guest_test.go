package domain

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Н19
func TestNormalizeGuestName(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    string
		wantErr error
	}{
		{"plain", "Вася", "Вася", nil},
		{"trims and collapses spaces", "  Вася \t  Пупкин  ", "Вася Пупкин", nil},
		{"strips zero-width and bidi override", "Ва\u200Bс\u202Eя", "Вася", nil},
		{"strips BOM and isolates", "\uFEFFИ\u2066ра\u2069", "Ира", nil},
		{"NFKC folds fullwidth", "ＡＢＣ", "ABC", nil},
		{"32 runes ok", strings.Repeat("я", 32), strings.Repeat("я", 32), nil},
		{"33 runes rejected", strings.Repeat("я", 33), "", ErrInvalidGuestName},
		{"empty", "", "", ErrInvalidGuestName},
		{"only zero-width", "\u200B\u200C\u200D", "", ErrInvalidGuestName},
		{"only spaces", "   ", "", ErrInvalidGuestName},
		{"reserved ru", "Администратор", "", ErrReservedGuestName},
		{"reserved case-insensitive", "ADMIN", "", ErrReservedGuestName},
		{"reserved with cyrillic lookalike A", "Аdmin", "", ErrReservedGuestName},
		{"reserved with separators", "mod.er_a-tor", "", ErrReservedGuestName},
		{"reserved hidden by zero-width", "Ad\u200Bmin", "", ErrReservedGuestName},
		{"reserved guest word", "Гость", "", ErrReservedGuestName},
		{"reserved as part of longer name is allowed", "Администратор Вася", "Администратор Вася", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := NormalizeGuestName(c.in)
			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("NormalizeGuestName(%q) err = %v, want %v", c.in, err, c.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeGuestName(%q) unexpected err %v", c.in, err)
			}
			if got != c.want {
				t.Fatalf("NormalizeGuestName(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestGuestStatusIsActive(t *testing.T) {
	active := map[GuestStatus]bool{
		GuestStatusLobby: true, GuestStatusAdmitted: true,
		GuestStatusRejected: false, GuestStatusLobbyTimeout: false, GuestStatusLeft: false,
		GuestStatusKicked: false, GuestStatusRevoked: false, GuestStatusCallEnded: false,
	}
	for s, want := range active {
		if s.IsActive() != want {
			t.Fatalf("%s.IsActive() = %v, want %v", s, !want, want)
		}
	}
}

func usableTarget(now time.Time) *GuestLinkTarget {
	return &GuestLinkTarget{
		Link:              GuestLink{ID: uuid.New(), ExpiresAt: now.Add(time.Hour)},
		GuestLinksEnabled: true,
	}
}

func TestGuestLinkTargetUsable(t *testing.T) {
	now := time.Now()
	past := now.Add(-time.Minute)
	manual, callEnded, disabled := GuestRevokeManual, GuestRevokeCallEnded, GuestRevokeServerDisabled

	cases := []struct {
		name   string
		mutate func(*GuestLinkTarget)
		want   error
	}{
		{"usable", func(*GuestLinkTarget) {}, nil},
		{"revoked manually", func(t *GuestLinkTarget) { t.Link.RevokedAt, t.Link.RevokeReason = &past, &manual }, ErrGuestLinkRevoked},
		{"revoked by call end", func(t *GuestLinkTarget) { t.Link.RevokedAt, t.Link.RevokeReason = &past, &callEnded }, ErrGuestCallEnded},
		{"revoked by server toggle", func(t *GuestLinkTarget) { t.Link.RevokedAt, t.Link.RevokeReason = &past, &disabled }, ErrGuestLinksDisabled},
		{"call ended, not yet swept", func(t *GuestLinkTarget) { t.CallEndedAt = &past }, ErrGuestCallEnded},
		{"server disabled, not yet swept", func(t *GuestLinkTarget) { t.GuestLinksEnabled = false }, ErrGuestLinksDisabled},
		{"expired exactly now", func(t *GuestLinkTarget) { t.Link.ExpiresAt = now }, ErrGuestLinkExpired},
		{"closed", func(t *GuestLinkTarget) { t.Link.ClosedAt = &past }, ErrGuestLinkClosed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			target := usableTarget(now)
			c.mutate(target)
			if err := target.Usable(now); !errors.Is(err, c.want) && !(err == nil && c.want == nil) {
				t.Fatalf("Usable = %v, want %v", err, c.want)
			}
		})
	}
}

func TestGuestContextSessionUsable(t *testing.T) {
	ok := GuestContext{Guest: CallGuest{Status: GuestStatusAdmitted}, GuestLinksEnabled: true}
	if !ok.SessionUsable() {
		t.Fatal("admitted guest with live link/call/server must be usable")
	}
	for name, c := range map[string]GuestContext{
		"final status": {Guest: CallGuest{Status: GuestStatusKicked}, GuestLinksEnabled: true},
		"link revoked": {Guest: CallGuest{Status: GuestStatusLobby}, GuestLinksEnabled: true, LinkRevoked: true},
		"call ended":   {Guest: CallGuest{Status: GuestStatusAdmitted}, GuestLinksEnabled: true, CallEnded: true},
		"server off":   {Guest: CallGuest{Status: GuestStatusAdmitted}},
	} {
		if c.SessionUsable() {
			t.Fatalf("%s: SessionUsable must be false", name)
		}
	}
}
