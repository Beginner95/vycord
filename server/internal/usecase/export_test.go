package usecase

import (
	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

// HashOTPCodeForTest открывает hashOTPCode внешним тестам. Файл называется
// export_test.go, поэтому в обычную сборку не попадает — публичной эта
// функция не становится.
func HashOTPCodeForTest(secret string, userID uuid.UUID, p domain.OTPPurpose, code string) []byte {
	return hashOTPCode(secret, userID, p, code)
}
