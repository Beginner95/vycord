package attachlink_test

import (
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/pkg/attachlink"
)

const secret = "test-secret"

func parseLink(t *testing.T, link string) (exp, sig string) {
	t.Helper()
	u, err := url.Parse(link)
	require.NoError(t, err)
	return u.Query().Get("exp"), u.Query().Get("sig")
}

func TestContentURLShape(t *testing.T) {
	id := uuid.New()
	s := attachlink.NewSigner(secret, 7*24*time.Hour)

	link := s.ContentURL(id)

	assert.True(t, strings.HasPrefix(link, "/api/v1/attachments/"+id.String()+"/content?"), "получено: %s", link)
	exp, sig := parseLink(t, link)
	assert.NotEmpty(t, exp)
	assert.NotEmpty(t, sig)
}

func TestThumbURLShape(t *testing.T) {
	id := uuid.New()
	s := attachlink.NewSigner(secret, time.Hour)

	link := s.ThumbURL(id)

	assert.True(t, strings.HasPrefix(link, "/api/v1/attachments/"+id.String()+"/thumb?"), "получено: %s", link)
}

func TestVerifyAcceptsFreshSignature(t *testing.T) {
	id := uuid.New()
	s := attachlink.NewSigner(secret, time.Hour)

	exp, sig := parseLink(t, s.ContentURL(id))

	assert.NoError(t, s.Verify(id, exp, sig))
}

func TestVerifyRejectsExpiredSignature(t *testing.T) {
	id := uuid.New()
	s := attachlink.NewSigner(secret, time.Hour)
	exp, sig := parseLink(t, s.ContentURL(id))

	// Подпись валидна, но время ушло вперёд на сутки.
	s.Now = func() time.Time { return time.Now().Add(24 * time.Hour) }

	assert.ErrorIs(t, s.Verify(id, exp, sig), attachlink.ErrLinkExpired)
}

func TestVerifyRejectsTamperedSignature(t *testing.T) {
	id := uuid.New()
	s := attachlink.NewSigner(secret, time.Hour)
	exp, _ := parseLink(t, s.ContentURL(id))

	assert.ErrorIs(t, s.Verify(id, exp, "deadbeef"), attachlink.ErrLinkInvalid)
}

func TestVerifyRejectsSignatureOfAnotherAttachment(t *testing.T) {
	// Подпись привязана к id: подставив чужой id в тот же URL, доступ не получить.
	s := attachlink.NewSigner(secret, time.Hour)
	exp, sig := parseLink(t, s.ContentURL(uuid.New()))

	assert.ErrorIs(t, s.Verify(uuid.New(), exp, sig), attachlink.ErrLinkInvalid)
}

func TestVerifyRejectsExtendedExpiry(t *testing.T) {
	// Продлить срок, поправив exp в URL, нельзя: exp входит в подпись.
	id := uuid.New()
	s := attachlink.NewSigner(secret, time.Hour)
	_, sig := parseLink(t, s.ContentURL(id))

	forged := time.Now().Add(365 * 24 * time.Hour).Unix()

	assert.ErrorIs(t, s.Verify(id, strconv.FormatInt(forged, 10), sig), attachlink.ErrLinkInvalid)
}

func TestVerifyRejectsGarbageExpiry(t *testing.T) {
	s := attachlink.NewSigner(secret, time.Hour)

	assert.ErrorIs(t, s.Verify(uuid.New(), "not-a-number", "abc"), attachlink.ErrLinkInvalid)
}
