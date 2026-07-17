package usecase

import (
	"regexp"

	"github.com/google/uuid"
)

var (
	userMentionRe = regexp.MustCompile(`<@([0-9a-fA-F-]{36})>`)
	everyoneRe    = regexp.MustCompile(`@everyone`)
)

// parsedMentions — результат разбора текста сообщения на упоминания.
// Роли (<@&owner|admin|member>) здесь не извлекаются: они не требуют
// серверной валидации (regex на клиенте уже ограничивает набор тремя
// известными значениями) и нужны только для рендера на клиенте.
type parsedMentions struct {
	userIDs  []uuid.UUID
	everyone bool
}

func parseMentions(content string) parsedMentions {
	var m parsedMentions
	for _, match := range userMentionRe.FindAllStringSubmatch(content, -1) {
		if id, err := uuid.Parse(match[1]); err == nil {
			m.userIDs = append(m.userIDs, id)
		}
	}
	m.everyone = everyoneRe.MatchString(content)
	return m
}
