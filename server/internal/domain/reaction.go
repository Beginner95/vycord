package domain

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/rivo/uniseg"
)

// MaxDistinctReactions — сколько разных реакций может быть у одного
// сообщения (VYC-106). Существующую реакцию лимит не останавливает.
const MaxDistinctReactions = 20

const (
	stickerKeyPrefix = "sticker:"
	maxEmojiBytes    = 32
)

// ReactionKey — реакция в разобранном виде: ровно одно из полей задано.
type ReactionKey struct {
	Emoji     string
	StickerID *uuid.UUID
}

// String — каноническая строка ключа, та же, что в URL и в снимке.
func (k ReactionKey) String() string {
	if k.StickerID != nil {
		return stickerKeyPrefix + k.StickerID.String()
	}
	return k.Emoji
}

// ParseReactionKey разбирает ключ из URL: `sticker:<uuid>` или один эмодзи.
func ParseReactionKey(raw string) (ReactionKey, error) {
	if rest, ok := strings.CutPrefix(raw, stickerKeyPrefix); ok {
		id, err := uuid.Parse(rest)
		if err != nil {
			return ReactionKey{}, ErrReactionInvalid
		}
		return ReactionKey{StickerID: &id}, nil
	}
	if !isSingleEmoji(raw) {
		return ReactionKey{}, ErrReactionInvalid
	}
	return ReactionKey{Emoji: raw}, nil
}

// isSingleEmoji — один графемный кластер без ASCII, букв, цифр, пробелов и
// управляющих символов, с хотя бы одним символом категории So. Модификаторы
// тона (Sk), VS16 (Mn) и ZWJ (Cf) проходят как части кластера. Отсутствие
// ASCII заодно гарантирует, что эмодзи-ключ никогда не совпадёт с
// текстовым UUID стикера (на этом стоит подсчёт видов в репозитории).
func isSingleEmoji(s string) bool {
	if s == "" || len(s) > maxEmojiBytes || !utf8.ValidString(s) {
		return false
	}
	if uniseg.GraphemeClusterCount(s) != 1 {
		return false
	}
	hasSymbol := false
	for _, r := range s {
		switch {
		case r < utf8.RuneSelf, unicode.IsLetter(r), unicode.IsDigit(r), unicode.IsSpace(r), unicode.IsControl(r):
			return false
		case unicode.Is(unicode.So, r):
			hasSymbol = true
		}
	}
	return hasSymbol
}

// Reaction — одна реакция сообщения в снимке: вид, сколько раз и кем
// поставлена. Порядок в снимке — по времени первой реакции этого вида.
type Reaction struct {
	Key     string      `json:"key"`
	Emoji   string      `json:"emoji,omitempty"`
	Sticker *Sticker    `json:"sticker,omitempty"`
	Count   int         `json:"count"`
	UserIDs []uuid.UUID `json:"user_ids,omitempty"`
}

// ReactionsWithoutUsers — снимок для гостя: счётчики без идентификаторов
// участников. Никогда не nil — пустой снимок уходит как [].
func ReactionsWithoutUsers(rs []Reaction) []Reaction {
	out := make([]Reaction, len(rs))
	for i, r := range rs {
		r.UserIDs = nil
		out[i] = r
	}
	return out
}

// ReactionRepository — хранение реакций. Add и Remove возвращают полный
// снимок реакций сообщения, прочитанный в той же транзакции.
type ReactionRepository interface {
	// Add идемпотентен. ErrReactionLimitReached — вид новый, а видов уже maxDistinct.
	Add(messageID, userID uuid.UUID, key ReactionKey, maxDistinct int) ([]Reaction, error)
	// Remove идемпотентен: отсутствие реакции — не ошибка.
	Remove(messageID, userID uuid.UUID, key ReactionKey) ([]Reaction, error)
	// ListByMessageIDs — снимки пачки сообщений одним запросом.
	ListByMessageIDs(ids []uuid.UUID) (map[uuid.UUID][]Reaction, error)
}
