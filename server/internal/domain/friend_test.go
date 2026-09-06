package domain_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
)

func TestFriendProfileJSONIsFlat(t *testing.T) {
	id := uuid.New()
	p := domain.FriendProfile{
		UserBrief:    domain.UserBrief{UserID: id, Username: "vaha"},
		FriendsSince: time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC),
	}

	data, err := json.Marshal(p)
	require.NoError(t, err)

	var m map[string]any
	require.NoError(t, json.Unmarshal(data, &m))

	assert.Equal(t, id.String(), m["user_id"], "user_id обязан быть плоским полем")
	assert.Equal(t, "vaha", m["username"])
	assert.Contains(t, m, "friends_since")
	assert.NotContains(t, m, "user", "профиль друга не вкладывает UserBrief")
	assert.NotContains(t, m, "avatar_url", "пустой аватар опускается omitempty")
}

func TestFriendRequestJSONNestsUser(t *testing.T) {
	id := uuid.New()
	r := domain.FriendRequest{
		ID:        uuid.New(),
		User:      domain.UserBrief{UserID: id, Username: "vaha"},
		CreatedAt: time.Now(),
	}

	data, err := json.Marshal(r)
	require.NoError(t, err)

	var m map[string]any
	require.NoError(t, json.Unmarshal(data, &m))

	user, ok := m["user"].(map[string]any)
	require.True(t, ok, "заявка вкладывает собеседника полем user")
	assert.Equal(t, id.String(), user["user_id"])
	assert.NotContains(t, m, "user_id", "плоского user_id в заявке быть не должно")
}

func TestPrivacyModeValidation(t *testing.T) {
	assert.True(t, domain.PrivacyMode("everyone").ValidForFriendRequests())
	assert.True(t, domain.PrivacyMode("mutual_servers").ValidForFriendRequests())
	assert.True(t, domain.PrivacyMode("none").ValidForFriendRequests())
	assert.False(t, domain.PrivacyMode("friends").ValidForFriendRequests(),
		"'friends' — режим только для ЛС, для заявок он бессмыслен")
	assert.False(t, domain.PrivacyMode("").ValidForFriendRequests())

	assert.True(t, domain.PrivacyMode("friends").ValidForDM())
	assert.True(t, domain.PrivacyMode("everyone").ValidForDM())
	assert.True(t, domain.PrivacyMode("mutual_servers").ValidForDM())
	assert.False(t, domain.PrivacyMode("none").ValidForDM(),
		"'none' для ЛС не существует: 'friends' уже самый строгий режим")
}
