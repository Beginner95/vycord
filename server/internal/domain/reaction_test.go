package domain

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseReactionKey_AcceptsRealEmoji(t *testing.T) {
	for _, raw := range []string{"👍", "❤️", "👍🏽", "👨‍👩‍👧", "🇷🇺", "✅", "☕", "🖐️"} {
		k, err := ParseReactionKey(raw)
		require.NoError(t, err, raw)
		assert.Equal(t, raw, k.Emoji, raw)
		assert.Nil(t, k.StickerID, raw)
		assert.Equal(t, raw, k.String(), raw)
	}
}

func TestParseReactionKey_RejectsNonEmoji(t *testing.T) {
	long := "👨‍👩‍👧‍👦👨‍👩‍👧‍👦" // два кластера и > 32 байт
	for _, raw := range []string{"", "a", "ab", "1️⃣", "👍👍", " 👍", "👍 ", "\u0007", "й", long, "sticker:", "sticker:nope"} {
		_, err := ParseReactionKey(raw)
		assert.ErrorIs(t, err, ErrReactionInvalid, "%q", raw)
	}
}

func TestParseReactionKey_Sticker(t *testing.T) {
	id := uuid.New()
	k, err := ParseReactionKey("sticker:" + id.String())
	require.NoError(t, err)
	require.NotNil(t, k.StickerID)
	assert.Equal(t, id, *k.StickerID)
	assert.Empty(t, k.Emoji)
	assert.Equal(t, "sticker:"+id.String(), k.String())
}

func TestReactionsWithoutUsers(t *testing.T) {
	in := []Reaction{{Key: "👍", Emoji: "👍", Count: 2, UserIDs: []uuid.UUID{uuid.New(), uuid.New()}}}
	out := ReactionsWithoutUsers(in)
	require.Len(t, out, 1)
	assert.Nil(t, out[0].UserIDs)
	assert.Equal(t, 2, out[0].Count)
	assert.Len(t, in[0].UserIDs, 2, "исходный снимок не мутируется")

	raw, err := json.Marshal(ReactionsWithoutUsers(nil))
	require.NoError(t, err)
	assert.JSONEq(t, `[]`, string(raw), "пустой снимок — массив, не null")
}

func TestReactionJSONShape(t *testing.T) {
	uid := uuid.New()
	raw, err := json.Marshal(Reaction{Key: "👍", Emoji: "👍", Count: 1, UserIDs: []uuid.UUID{uid}})
	require.NoError(t, err)
	assert.JSONEq(t, `{"key":"👍","emoji":"👍","count":1,"user_ids":["`+uid.String()+`"]}`, string(raw))
}
