package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

func TestAttachmentKindValues(t *testing.T) {
	// Значения обязаны совпадать с CHECK-ограничением в миграции 018:
	// рассинхрон здесь даёт ошибку записи в БД, а не ошибку компиляции.
	assert.Equal(t, domain.AttachmentKind("image"), domain.AttachmentKindImage)
	assert.Equal(t, domain.AttachmentKind("video"), domain.AttachmentKindVideo)
	assert.Equal(t, domain.AttachmentKind("audio"), domain.AttachmentKindAudio)
	assert.Equal(t, domain.AttachmentKind("file"), domain.AttachmentKindFile)
}

func TestAttachmentKindIsValid(t *testing.T) {
	assert.True(t, domain.AttachmentKindImage.IsValid())
	assert.False(t, domain.AttachmentKind("executable").IsValid())
	assert.False(t, domain.AttachmentKind("").IsValid())
}
