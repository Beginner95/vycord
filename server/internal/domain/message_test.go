package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMessageIsAuthoredBy(t *testing.T) {
	u := uuid.New()
	if !(&Message{UserID: &u}).IsAuthoredBy(u) {
		t.Fatal("author must match")
	}
	if (&Message{UserID: &u}).IsAuthoredBy(uuid.New()) {
		t.Fatal("other user must not match")
	}
	g := uuid.New()
	if (&Message{GuestID: &g}).IsAuthoredBy(g) {
		t.Fatal("a guest message is never authored by a user, even with an equal UUID")
	}
}

func TestGuestMessageJSON(t *testing.T) {
	g := uuid.New()
	b, err := json.Marshal(&Message{GuestID: &g, Guest: &MessageGuest{ID: g, DisplayName: "Вася"}, Kind: "user"})
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, `"user_id":null`) {
		t.Fatalf("guest message must serialise user_id as null: %s", s)
	}
	if !strings.Contains(s, `"guest":{"id":"`+g.String()+`","display_name":"Вася"}`) {
		t.Fatalf("guest object missing: %s", s)
	}
	if strings.Contains(s, "guest_id") {
		t.Fatalf("guest_id is internal: %s", s)
	}
}
