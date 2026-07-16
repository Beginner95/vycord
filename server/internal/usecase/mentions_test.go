package usecase

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestParseMentions_ExtractsUserIDsAndEveryone(t *testing.T) {
	id1, id2 := uuid.New(), uuid.New()
	content := "hey <@" + id1.String() + "> and <@" + id2.String() + ">, @everyone check this"

	m := parseMentions(content)

	assert.ElementsMatch(t, []uuid.UUID{id1, id2}, m.userIDs)
	assert.True(t, m.everyone)
}

func TestParseMentions_NoMentions(t *testing.T) {
	m := parseMentions("just a normal message")

	assert.Empty(t, m.userIDs)
	assert.False(t, m.everyone)
}

func TestParseMentions_InvalidUUIDShape_Ignored(t *testing.T) {
	// 36 символов из допустимого набора [0-9a-f-], но без дефисов на нужных
	// позициях — совпадает с формой regex, но uuid.Parse должен отклонить.
	m := parseMentions("<@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>")

	assert.Empty(t, m.userIDs)
}

func TestParseMentions_EveryoneOnly(t *testing.T) {
	m := parseMentions("ping @everyone please")

	assert.Empty(t, m.userIDs)
	assert.True(t, m.everyone)
}
