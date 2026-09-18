package sfuclient

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKickGuest(t *testing.T) {
	roomID, guestID := uuid.New(), uuid.New()
	var gotBody map[string]string
	var gotSecret, gotPath string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSecret = r.Header.Get("X-Internal-Secret")
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := New(srv.URL, "s3cr3t")
	require.NoError(t, c.KickGuest(context.Background(), roomID, "guest:"+guestID.String()))
	assert.Equal(t, "/kick", gotPath)
	assert.Equal(t, "s3cr3t", gotSecret)
	assert.Equal(t, map[string]string{"room_id": roomID.String(), "identity": "guest:" + guestID.String()}, gotBody)
}

func TestKickGuestPropagatesFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	err := New(srv.URL, "wrong").KickGuest(context.Background(), uuid.New(), "guest:"+uuid.NewString())
	assert.ErrorContains(t, err, "403")
}

func TestGuestPresence(t *testing.T) {
	roomID, guestID := uuid.New(), uuid.New()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/guest-presence", r.URL.Path)
		_ = json.NewEncoder(w).Encode(map[string][]string{
			roomID.String(): {"guest:" + guestID.String(), "garbage", uuid.NewString()},
		})
	}))
	defer srv.Close()

	got, err := New(srv.URL, "s").GuestPresence(context.Background())
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID][]uuid.UUID{roomID: {guestID}}, got,
		"entries that are not guest identities are ignored, never fatal")
}

func TestNilClientIsANoOp(t *testing.T) {
	var c *Client
	assert.NoError(t, c.KickGuest(context.Background(), uuid.New(), "guest:x"))
	got, err := c.GuestPresence(context.Background())
	assert.NoError(t, err)
	assert.Empty(t, got)
}
