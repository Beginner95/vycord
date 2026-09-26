package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/phonecrypto"
)

var testPhoneKey = []byte("0123456789abcdef0123456789abcdef") // 32 байта, только для тестов

func mustCipher(t *testing.T, phone string) *string {
	t.Helper()
	blob, err := phonecrypto.Encrypt(testPhoneKey, phone)
	require.NoError(t, err)
	return &blob
}

func newUserPhoneUC(t *testing.T) (domain.UserUseCase, *MockUserRepository) {
	t.Helper()
	ur := new(MockUserRepository)
	return usecase.NewUserUseCase(ur, nil, testPhoneKey), ur
}

func TestSetPhone_InvalidNumberRejected(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	_, err := uc.SetPhone(id, "not-a-phone")

	require.ErrorIs(t, err, domain.ErrInvalidPhone)
	ur.AssertNotCalled(t, "SetPhone")
}

func TestSetPhone_NormalizesAndStoresEncrypted(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	// Нормализация проверяется через ожидаемый индекс: raw-ввод с разделителями
	// обязан привестись к индексу ОТ +79123456789 ИНАЧЕ мок не совпадёт.
	index, err := phonecrypto.Index(testPhoneKey, "+79123456789")
	require.NoError(t, err)
	ur.On("SetPhone", id, index, mock.Anything).Return(nil)
	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me", PhoneCipher: mustCipher(t, "+79123456789")}, nil)

	got, err := uc.SetPhone(id, "+7 (912) 345-67-89")

	require.NoError(t, err)
	require.NotNil(t, got.PhoneMasked)
	assert.Equal(t, "+79123 ••• •• 89", *got.PhoneMasked)
}

func TestSetPhone_Taken(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	index, _ := phonecrypto.Index(testPhoneKey, "+79123456789")
	ur.On("SetPhone", id, index, mock.Anything).Return(domain.ErrPhoneTaken)

	_, err := uc.SetPhone(id, "+79123456789")

	require.ErrorIs(t, err, domain.ErrPhoneTaken)
}

func TestClearPhone_ReturnsUserWithoutMask(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	ur.On("ClearPhone", id).Return(nil)
	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me"}, nil)

	got, err := uc.ClearPhone(id)

	require.NoError(t, err)
	assert.Nil(t, got.PhoneMasked)
}

func TestGetMe_FillsPhoneMasked(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me", PhoneCipher: mustCipher(t, "+79123456789")}, nil)

	got, err := uc.GetMe(id)

	require.NoError(t, err)
	require.NotNil(t, got.PhoneMasked)
	assert.Equal(t, "+79123 ••• •• 89", *got.PhoneMasked)
}
