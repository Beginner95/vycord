package usecase

import "github.com/vycord/server/internal/domain"

// HashOTPCodeForTest открывает hashOTPCode внешним тестам. Файл называется
// export_test.go, поэтому в обычную сборку не попадает — публичной эта
// функция не становится.
func HashOTPCodeForTest(secret, email string, p domain.OTPPurpose, code string) []byte {
	return hashOTPCode(secret, email, p, code)
}

// GuestIPHashForTest открывает guestIPHash внешним тестам.
func GuestIPHashForTest(key []byte, ip string) []byte {
	return guestIPHash(key, ip)
}

// GuestUseCaseForTest открывает конкретный тип гостевого use case внешним
// тестам, пока он ещё не реализует domain.GuestUseCase целиком (планы 2/9).
type GuestUseCaseForTest = guestUseCase

func NewGuestUseCaseForTest(d GuestUseCaseDeps) *GuestUseCaseForTest {
	return newGuestUseCase(d)
}
